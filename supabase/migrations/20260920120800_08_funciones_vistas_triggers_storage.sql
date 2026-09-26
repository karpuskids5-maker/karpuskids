-- ==========================================================================
-- KARPUS KIDS / MIGRACION CONSOLIDADA 8/10 - FUNCIONES, VISTAS, TRIGGERS Y STORAGE
--
-- Generada por auditoria de los 36 archivos de migraciones/operativos/ y
-- los 8 de supabase/migrations/ (44 fuentes en total). Esta migracion y las 9
-- restantes son las unicas que se conservan: las 44 fuentes originales se
-- eliminaron del repositorio tras consolidar y corregir sus defectos.
--
-- IDEMPOTENTE: se puede aplicar sobre la base ya desplegada sin perder datos.
-- Ejecutar en orden 01 -> 10 (ver README de migraciones).
-- ==========================================================================

-- 136 funciones, 5 vistas, 26 triggers, 3 buckets.
-- Orden: funciones -> vistas -> triggers -> buckets -> politicas de storage -> grants.

-- Funciones que consultaban tablas eliminadas en la migracion 10
-- (se omiten; la migracion 10 publica su reemplazo):
--   - public.generate_annual_payments -> payment_plans
--   - public.pay_full_year -> payment_plans


-- ---- FUNCIONES -----------------------------------------------------------
CREATE OR REPLACE FUNCTION create_store_order(
    p_student_id  bigint,
    p_items       JSONB,
    p_notes       TEXT DEFAULT NULL
  )
  RETURNS UUID
  LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_parent_id UUID := auth.uid();
    v_order_id  UUID;
    v_item      JSONB;
    v_product   store_products%ROWTYPE;
    v_size_stock INT;
  BEGIN
    INSERT INTO store_orders (parent_id, student_id, notes)
    VALUES (v_parent_id, p_student_id, p_notes)
    RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      SELECT * INTO v_product
      FROM store_products
      WHERE id = (v_item->>'product_id')::UUID AND is_active = TRUE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'product_id';
      END IF;

      -- Validación por talla cuando el ítem trae talla
      IF COALESCE(v_item->>'size_label','') <> '' THEN
        SELECT s.stock INTO v_size_stock
        FROM store_product_sizes s
        WHERE s.product_id = v_product.id
          AND s.size_label = v_item->>'size_label';

        IF v_size_stock IS NULL THEN
          RAISE EXCEPTION 'La talla "%" no existe para "%"', v_item->>'size_label', v_product.name;
        END IF;

        IF v_size_stock < (v_item->>'quantity')::INT THEN
          RAISE EXCEPTION 'Stock insuficiente en talla % de "%": disponible %, solicitado %',
            v_item->>'size_label', v_product.name, v_size_stock, v_item->>'quantity';
        END IF;
      ELSE
        IF v_product.stock < (v_item->>'quantity')::INT THEN
          RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
            v_product.name, v_product.stock, v_item->>'quantity';
        END IF;
      END IF;

      INSERT INTO store_order_items (order_id, product_id, quantity, unit_price, size_label)
      VALUES (
        v_order_id,
        (v_item->>'product_id')::UUID,
        (v_item->>'quantity')::INT,
        v_product.price,
        NULLIF(v_item->>'size_label','')
      );
    END LOOP;

    RETURN v_order_id;
  END;
  $$;

CREATE OR REPLACE FUNCTION get_all_store_orders(p_status TEXT DEFAULT NULL)
  RETURNS TABLE (
    id           UUID,
    status       TEXT,
    total        NUMERIC,
    notes        TEXT,
    created_at   TIMESTAMPTZ,
    parent_name  TEXT,
    student_name TEXT,
    items        JSONB
  )
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
      o.id, o.status, o.total, o.notes, o.created_at,
      pr.name  AS parent_name,
      st.name  AS student_name,
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'product_name', pd.name,
          'size_label',   i.size_label,
          'quantity',     i.quantity,
          'unit_price',   i.unit_price,
          'subtotal',     i.subtotal
        )) FILTER (WHERE i.id IS NOT NULL),
        '[]'::jsonb
      ) AS items
    FROM store_orders o
    LEFT JOIN profiles pr          ON pr.id = o.parent_id
    LEFT JOIN students st          ON st.id = o.student_id
    LEFT JOIN store_order_items i  ON i.order_id = o.id
    LEFT JOIN store_products pd    ON pd.id = i.product_id
    WHERE (p_status IS NULL OR o.status = p_status)
    GROUP BY o.id, pr.name, st.name
    ORDER BY o.created_at DESC;
  $$;

CREATE OR REPLACE FUNCTION get_my_store_orders()
  RETURNS TABLE (
    id           UUID,
    status       TEXT,
    total        NUMERIC,
    notes        TEXT,
    created_at   TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    items        JSONB
  )
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
      o.id, o.status, o.total, o.notes, o.created_at, o.delivered_at,
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'product_name', p.name,
          'size_label',   i.size_label,
          'quantity',     i.quantity,
          'unit_price',   i.unit_price,
          'subtotal',     i.subtotal
        )) FILTER (WHERE i.id IS NOT NULL),
        '[]'::jsonb
      ) AS items
    FROM store_orders o
    LEFT JOIN store_order_items i ON i.order_id = o.id
    LEFT JOIN store_products p    ON p.id = i.product_id
    WHERE o.parent_id = auth.uid()
    GROUP BY o.id
    ORDER BY o.created_at DESC;
  $$;

CREATE OR REPLACE FUNCTION get_store_catalog()
  RETURNS TABLE (
    id            UUID,
    name          TEXT,
    description   TEXT,
    price         NUMERIC,
    images        TEXT[],
    stock         INT,
    unit          TEXT,
    has_sizes     BOOLEAN,
    category      TEXT,
    category_icon TEXT,
    sizes         JSONB
  )
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
      p.id, p.name, p.description, p.price,
      COALESCE(p.images, '{}'),
      p.stock, p.unit,
      p.has_sizes,
      c.name        AS category,
      c.icon        AS category_icon,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('label', s.size_label, 'stock', s.stock) ORDER BY s.size_label)
        FROM store_product_sizes s WHERE s.product_id = p.id),
        '[]'::jsonb
      ) AS sizes
    FROM store_products p
    LEFT JOIN store_categories c ON c.id = p.category_id
    WHERE p.is_active = TRUE
    ORDER BY c.sort_order, p.name;
  $$;

CREATE OR REPLACE FUNCTION get_store_inventory(p_limit INT DEFAULT 50)
  RETURNS TABLE (
    id            UUID,
    created_at    TIMESTAMPTZ,
    type          TEXT,
    type_label    TEXT,
    quantity      INT,
    reason        TEXT,
    size_label    TEXT,
    product_name  TEXT,
    product_image TEXT,
    category_name TEXT,
    actor_name    TEXT,
    order_id      UUID
  )
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
      i.id,
      i.created_at,
      i.type,
      CASE i.type
        WHEN 'entry'      THEN 'Entrada'
        WHEN 'exit'       THEN 'Salida'
        WHEN 'adjustment' THEN 'Ajuste'
        ELSE i.type
      END AS type_label,
      i.quantity,
      i.reason,
      i.size_label,
      p.name        AS product_name,
      COALESCE(p.images[1], '') AS product_image,
      c.name        AS category_name,
      pr.name       AS actor_name,
      i.order_id
    FROM store_inventory i
    LEFT JOIN store_products   p  ON p.id = i.product_id
    LEFT JOIN store_categories c  ON c.id = p.category_id
    LEFT JOIN profiles         pr ON pr.id = i.actor_id
    ORDER BY i.created_at DESC
    LIMIT p_limit;
  $$;

CREATE OR REPLACE FUNCTION public.activate_academic_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_period public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  SELECT * INTO v_period FROM public.academic_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  UPDATE public.academic_periods SET is_active=false WHERE school_year_id = v_period.school_year_id;
  UPDATE public.academic_periods SET is_active=true, status='open' WHERE id = p_period_id;
  RETURN jsonb_build_object('success',true,'id',v_period.id,'name',v_period.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_role text; v_period periods%ROWTYPE; v_old_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo la directora puede activar períodos'); END IF;
  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  SELECT id INTO v_old_id FROM public.periods WHERE is_active = true LIMIT 1;
  UPDATE public.periods SET is_active = false WHERE classroom_id = v_period.classroom_id OR classroom_id IS NULL;
  UPDATE public.periods SET is_active = true, status = 'open' WHERE id = p_period_id;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id,'period.activated',jsonb_build_object('new_period_id',p_period_id,'old_period_id',v_old_id),now());
  RETURN jsonb_build_object('success',true,'period_id',p_period_id,'period_name',v_period.name,'old_period_id',v_old_id);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.apply_payment_discount(
  p_payment_id bigint,
  p_pct        numeric DEFAULT 0,
  p_reason     text DEFAULT '',
  p_fixed      numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role        text;
  v_original    numeric;
  v_cur_amount  numeric;
  v_pct_eff     numeric;
  v_disc_amount numeric;
  v_new_amount  numeric;
  v_month       text;
  v_concept     text;
  v_student     bigint;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aplicar descuentos');
  END IF;

  SELECT amount, month_paid, concept, student_id, COALESCE(original_amount, amount) AS orig
    INTO v_cur_amount, v_month, v_concept, v_student, v_original
  FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;

  IF p_fixed IS NOT NULL AND p_fixed > 0 THEN
    v_disc_amount := round(GREATEST(0, LEAST(p_fixed, v_original))::numeric, 2);
  ELSE
    v_disc_amount := round((v_original * GREATEST(0, LEAST(COALESCE(p_pct,0), 100)) / 100)::numeric, 2);
  END IF;
  v_pct_eff := CASE WHEN v_original > 0 THEN round((v_disc_amount / v_original * 100)::numeric, 2) ELSE 0 END;
  v_new_amount := round((v_original - v_disc_amount)::numeric, 2);

  UPDATE public.payments
  SET amount          = v_new_amount,
      original_amount = v_original,
      discount_pct    = v_pct_eff,
      discount_amount = v_disc_amount,
      discount_reason = CASE WHEN v_pct_eff > 0 THEN COALESCE(NULLIF(trim(p_reason),''), discount_reason, 'Descuento')
                             ELSE NULL END,
      notes           = CASE WHEN v_pct_eff > 0
                             THEN COALESCE(NULLIF(notes,'') || ' | ', '') ||
                                  'Descuento ' || v_pct_eff::text || '% (RD$' || v_disc_amount::text || ')' ||
                                  CASE WHEN coalesce(p_reason,'') <> '' THEN ' — ' || p_reason ELSE '' END
                             ELSE COALESCE(notes,'') END,
      updated_at      = now()
  WHERE id = p_payment_id;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), 'payment.discount_applied',
    jsonb_build_object('payment_id', p_payment_id, 'student_id', v_student,
      'old_amount', v_cur_amount, 'new_amount', v_new_amount, 'original_amount', v_original,
      'discount_pct', v_pct_eff, 'discount_amount', v_disc_amount,
      'month_paid', v_month, 'concept', v_concept, 'reason', p_reason), now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id,
    'old_amount', v_cur_amount, 'original_amount', v_original, 'amount', v_new_amount,
    'discount_pct', v_pct_eff, 'discount_amount', v_disc_amount);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.apply_referral_reward(
  p_reward_id uuid,
  p_payment_id bigint
) RETURNS public.referral_rewards LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.referral_rewards%ROWTYPE;
BEGIN
  IF p_reward_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'reward_id y payment_id son obligatorios';
  END IF;

  SELECT * INTO v_row FROM public.referral_rewards WHERE id = p_reward_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Recompensa no encontrada'; END IF;

  IF v_row.parent_id <> auth.uid() THEN RAISE EXCEPTION 'Acceso denegado'; END IF;
  IF v_row.is_used THEN RAISE EXCEPTION 'Este crédito ya fue utilizado'; END IF;

  -- Verificar que el pago pertenezca a un estudiante del padre
  IF NOT EXISTS (
    SELECT 1 FROM public.payments p
    JOIN public.students s ON s.id = p.student_id
    WHERE p.id = p_payment_id AND s.parent_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'El pago no pertenece a un estudiante válido';
  END IF;

  UPDATE public.referral_rewards
    SET is_used = true, applied_to_payment_id = p_payment_id, used_at = now()
  WHERE id = p_reward_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_donation(
  p_donation_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount       NUMERIC(12,2);
  v_campaign_id  BIGINT;
BEGIN
  IF get_my_role() NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: no autorizado';
  END IF;

  UPDATE public.donations
  SET status = 'approved', approved_by = auth.uid()
  WHERE id = p_donation_id AND status = 'pending'
  RETURNING amount, campaign_id INTO v_amount, v_campaign_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Donación no encontrada o ya procesada');
  END IF;

  IF v_campaign_id IS NOT NULL THEN
    -- Bloqueo de fila para evitar pérdida de incrementos (lost update) en
    -- recaudaciones concurrentes sobre la misma campaña.
    PERFORM 1 FROM public.donation_campaigns
      WHERE id = v_campaign_id
      FOR UPDATE;

    UPDATE public.donation_campaigns
    SET raised_amount = raised_amount + v_amount
    WHERE id = v_campaign_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Donación aprobada exitosamente');
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_payment record; has_proof boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos');
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','El pago no existe'); END IF;
  IF v_payment.status = 'paid' THEN RETURN jsonb_build_object('error','El pago ya fue aprobado'); END IF;
  has_proof := (v_payment.proof_url IS NOT NULL AND v_payment.proof_url <> '') OR
               (v_payment.evidence_url IS NOT NULL AND v_payment.evidence_url <> '');
  IF NOT has_proof AND (COALESCE(v_payment.method,'efectivo') <> 'efectivo') THEN
    RETURN jsonb_build_object('error','No se puede aprobar una transferencia sin comprobante cargado');
  END IF;
  UPDATE public.payments
  SET status='paid', paid_date=now(), validated_by=auth.uid(), notes=COALESCE(p_notes,notes,'Aprobado vía sistema')
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'approved_by',auth.uid(),'approved_at',now());
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_student_to_classroom(p_student_id bigint, p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = p_student_id;
$$;

CREATE OR REPLACE FUNCTION public.assign_students_bulk(p_student_ids bigint[], p_classroom_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.students SET classroom_id = p_classroom_id WHERE id = ANY(p_student_ids);
$$;

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

CREATE OR REPLACE FUNCTION public.certify_donation(
  p_donation_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: no autorizado';
  END IF;

  UPDATE public.donations
  SET status = 'certified'
  WHERE id = p_donation_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solo se puede certificar una donación aprobada');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Certificado emitido para la donación');
END;
$$;

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

CREATE OR REPLACE FUNCTION public.close_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period        periods%ROWTYPE;
  v_ap_period     academic_periods%ROWTYPE;
  v_user_id       uuid; v_role text;
  v_student       record; v_config record;
  v_subject_avg   numeric(5,2); v_method text;
  v_total_avg     numeric(5,2); v_subject_count int;
  v_cards_created int := 0; v_level text;
  v_next_period   record;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error','Solo la directora puede cerrar períodos');
  END IF;

  -- Determinar si es academic_period o legacy period
  SELECT * INTO v_ap_period FROM public.academic_periods WHERE id = p_period_id;
  IF FOUND THEN
    IF v_ap_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.academic_periods SET status='closed', is_active=false WHERE id = p_period_id;
    SELECT * INTO v_next_period FROM public.academic_periods
    WHERE school_year_id = v_ap_period.school_year_id AND order_index = v_ap_period.order_index + 1;
  ELSE
    SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
    IF v_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.periods SET status='closed', is_active=false WHERE id = p_period_id;
  END IF;

  -- Calcular calificaciones por materia V2 (actividades + tareas con área)
  FOR v_student IN
    SELECT s.id AS student_id, s.classroom_id
    FROM public.students s
    WHERE s.classroom_id = COALESCE(v_period.classroom_id, v_ap_period.id) AND s.is_active = true
  LOOP
    v_total_avg := 0; v_subject_count := 0;
    FOR v_config IN
      SELECT pc.id AS config_id, pc.subject_id, s.name AS subject_name
      FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
      WHERE pc.period_id = p_period_id
    LOOP
      SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0))::text INTO v_method
      FROM (
        SELECT COUNT(*) AS a_cnt FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
      ) a, (
        SELECT COUNT(*) AS t_cnt FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
      ) b;
      IF v_method::int >= 5 THEN v_method := 'best_5'; ELSE v_method := 'all'; END IF;
      IF v_method = 'best_5' THEN
        SELECT ROUND(AVG(sv),2) INTO v_subject_avg FROM (
          SELECT g.score_v2 AS sv FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
          UNION ALL
          SELECT te.score_v2 AS sv FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
          WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
          ORDER BY sv DESC LIMIT 5) best;
      ELSE
        SELECT ROUND(AVG(sv),2) INTO v_subject_avg FROM (
          SELECT g.score_v2 AS sv FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
          UNION ALL
          SELECT te.score_v2 AS sv FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
          WHERE t.config_id = v_config.config_id AND te.student_id = v_student.student_id AND te.score_v2 IS NOT NULL
        ) allscores;
      END IF;
      IF v_subject_avg IS NOT NULL THEN
        INSERT INTO public.subject_averages (student_id, period_id, subject_id, average, graded_count, method)
        VALUES (v_student.student_id, p_period_id, v_config.subject_id, v_subject_avg, v_method::int,
          CASE WHEN v_method='best_5' THEN 'best_5' ELSE 'all' END)
        ON CONFLICT (student_id, period_id, subject_id) DO UPDATE SET
          average=EXCLUDED.average, graded_count=EXCLUDED.graded_count, method=EXCLUDED.method;
        v_total_avg := v_total_avg + v_subject_avg; v_subject_count := v_subject_count + 1;
      END IF;
    END LOOP;
    IF v_subject_count > 0 THEN v_total_avg := ROUND(v_total_avg / v_subject_count,2); ELSE v_total_avg := NULL; END IF;
    v_level := CASE WHEN v_total_avg IS NULL THEN 'Sin calificar'
                    WHEN v_total_avg >= 90 THEN 'Excelente'
                    WHEN v_total_avg >= 80 THEN 'Bueno'
                    WHEN v_total_avg >= 70 THEN 'En proceso'
                    ELSE 'Requiere apoyo' END;
    INSERT INTO public.report_cards (student_id, classroom_id, period_id, task_avg, formal_avg, final_score, level, generated_at)
    VALUES (v_student.student_id, v_student.classroom_id, p_period_id, v_total_avg, v_total_avg, v_total_avg, v_level, now())
    ON CONFLICT (student_id, period_id) DO UPDATE SET
      task_avg=EXCLUDED.task_avg, formal_avg=EXCLUDED.formal_avg, final_score=EXCLUDED.final_score,
      level=EXCLUDED.level, generated_at=now();
    v_cards_created := v_cards_created + 1;
  END LOOP;

  -- Avanzar al siguiente período o cerrar año
  IF v_next_period.id IS NOT NULL THEN
    UPDATE public.academic_periods SET status='open', is_active=true WHERE id = v_next_period.id;
    RETURN jsonb_build_object('success',true,'message','Período cerrado. Abierto: '||v_next_period.name,
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'opened_period',v_next_period.name,
      'next_period_id',v_next_period.id,'cards_generated',v_cards_created);
  ELSE
    IF v_ap_period.school_year_id IS NOT NULL THEN
      UPDATE public.school_years SET status='closed', updated_at=now() WHERE id = v_ap_period.school_year_id;
    END IF;
    RETURN jsonb_build_object('success',true,'message','Último período cerrado. Año escolar cerrado.',
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'year_closed',true,'cards_generated',v_cards_created);
  END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.create_academic_period(
  p_school_year_id bigint, p_name text, p_start_date date, p_end_date date,
  p_order_index integer, p_status text DEFAULT 'pending', p_is_active boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_row public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  INSERT INTO public.academic_periods (school_year_id, name, start_date, end_date, order_index, status, is_active)
  VALUES (p_school_year_id, p_name, p_start_date, p_end_date, p_order_index, p_status, p_is_active) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_school_year(
  p_name text, p_start_date date, p_end_date date,
  p_enrollment_start date DEFAULT NULL, p_enrollment_end date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL, p_reenrollment_end date DEFAULT NULL,
  p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_status text; v_row public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo directora o admin pueden crear años escolares'); END IF;
  v_status := COALESCE(p_status, CASE WHEN p_enrollment_start IS NOT NULL THEN 'draft' ELSE 'active' END);
  INSERT INTO public.school_years (name, start_date, end_date, enrollment_start, enrollment_end, reenrollment_start, reenrollment_end, status, created_by)
  VALUES (p_name, p_start_date, p_end_date, p_enrollment_start, p_enrollment_end, p_reenrollment_start, p_reenrollment_end, v_status, auth.uid())
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status,'created_at',v_row.created_at);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.ensure_referral_code(p_parent_id uuid)
RETURNS public.referral_codes LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code   public.referral_codes%ROWTYPE;
  v_parent public.profiles%ROWTYPE;
  v_stem   text;
  v_salt   text;
BEGIN
  IF p_parent_id IS NULL OR p_parent_id <> auth.uid() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT * INTO v_code FROM public.referral_codes WHERE parent_id = p_parent_id;
  IF v_code.id IS NOT NULL THEN
    RETURN v_code;
  END IF;

  SELECT * INTO v_parent FROM public.profiles WHERE id = p_parent_id;
  -- Extraer apellido o palabra clave del nombre para un código memorable
  v_stem := upper(trim(regexp_replace(
    coalesce(v_parent.name, 'FAMILIA'),
    '[^a-zA-Z ]', '', 'g'
  )));
  IF v_stem = '' OR v_stem IS NULL THEN v_stem := 'FAMILIA'; END IF;
  v_stem := substring(v_stem from 1 for 20);

  -- Sufijo numérico aleatorio de 3 dígitos
  v_salt := to_char(floor(random() * 900 + 100)::int, 'FM000');

  -- Caracter + año para aleatoriedad extra
  v_code.code := 'KARPUS-' || replace(v_stem, ' ', '-') || '-' || v_salt;

  -- Manejar colisión rara regenerando
  LOOP
    BEGIN
      INSERT INTO public.referral_codes (parent_id, code)
      VALUES (p_parent_id, v_code.code)
      RETURNING * INTO v_code;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_salt := to_char(floor(random() * 900 + 100)::int, 'FM000');
      v_code.code := 'KARPUS-' || replace(v_stem, ' ', '-') || '-' || v_salt;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  IF OLD.status = 'paid' THEN
    SELECT COALESCE(role, '') INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IN ('directora','asistente','admin') AND TG_OP = 'UPDATE' AND NEW.amount IS DISTINCT FROM OLD.amount THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No se puede modificar o eliminar un pago ya validado y aprobado.';
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.generate_student_charges(
  p_student_id          bigint,
  p_plan                text    DEFAULT 'mensual',
  p_inscription_amount  numeric DEFAULT 0,
  p_monthly_amount      numeric DEFAULT 0,
  p_prolongado_fee      numeric DEFAULT 0,
  p_discount_pct        numeric DEFAULT 0,
  p_due_day             int     DEFAULT 5,
  p_months              int     DEFAULT 10,
  p_start_month         text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role           text;
  v_start_month    text;
  v_discount       numeric;
  v_month_net      numeric;
  v_prolong_net    numeric;
  v_tot_net        numeric;
  v_charges        int     := 0;
  v_payments       int     := 0;
  v_i              int;
  v_month          text;
  v_due            date;
  v_half           int;
  v_sem_mes        text;
  v_insc_net       numeric;
  v_gen_day        int;
  v_due_day        int;
  v_curr           date    := current_date;
  v_start_date     date;
  v_first_due      date;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden generar cargos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'El estudiante no existe';
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_start_month := COALESCE(p_start_month, to_char(v_curr, 'YYYY-MM'));
  v_discount    := GREATEST(0, LEAST(COALESCE(p_discount_pct, 0), 100));
  v_month_net   := round(COALESCE(p_monthly_amount, 0) * (1 - v_discount / 100), 2);
  v_prolong_net := round(COALESCE(p_prolongado_fee, 0) * (1 - v_discount / 100), 2);

  v_start_date := to_date(v_start_month || '-01', 'YYYY-MM-DD');
  -- Inscripción y 1ª mensualidad vencen el día de generación del mes de inicio
  v_first_due  := (v_start_date + (v_gen_day - 1) * interval '1 day')::date;
  -- Si la admisión ocurre DESPUÉS del día de generación (ej.: el 28), se iguala
  -- a hoy para que ningún cobro "nazca vencido" con mora.
  IF v_first_due < v_curr THEN v_first_due := v_curr; END IF;

  -- ── Inscripción (siempre se genera, vence el día 25 del mes de inicio) ──
  IF COALESCE(p_inscription_amount, 0) > 0 THEN
    v_insc_net := round(p_inscription_amount * (1 - v_discount / 100), 2);

    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, due_date, status, created_by)
    VALUES (p_student_id, 'Inscripción', 'inscripcion',
            p_inscription_amount, v_discount, v_insc_net, v_first_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_insc_net, 'Inscripción', 'pending', v_first_due, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;
  END IF;

  -- ── Planes que el padre paga por adelantado (cuota única / dos semestres) ──
  IF p_plan = 'unico' THEN
    v_tot_net := v_month_net * GREATEST(p_months, 1);
    v_due     := v_first_due;

    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
    VALUES (p_student_id, 'Cuota Única Anual', 'mensualidad',
            round(COALESCE(p_monthly_amount, 0) * GREATEST(p_months, 1), 2),
            v_discount, v_tot_net, v_start_month, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, created_at)
    VALUES (p_student_id, v_tot_net, 'Cuota Única Anual', 'pending', v_due, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;

  ELSIF p_plan = 'doble' THEN
    v_half := floor(GREATEST(p_months, 1) / 2.0)::int;
    FOR v_i IN 0..1 LOOP
      v_sem_mes := to_char(v_start_date + (v_i * v_half) * interval '1 month', 'YYYY-MM');
      v_tot_net := v_month_net * (GREATEST(p_months, 1) - v_i * v_half);
      IF v_i = 0 THEN
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_sem_mes || '-01', 'YYYY-MM-DD')
                  + (v_due_day - 1) * interval '1 day')::date;
      END IF;

      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END,
              'mensualidad',
              round(COALESCE(p_monthly_amount, 0) * (GREATEST(p_months, 1) - v_i * v_half), 2),
              v_discount, v_tot_net, v_sem_mes, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;

      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, created_at)
      VALUES (p_student_id, v_tot_net,
              CASE WHEN v_i = 0 THEN 'Semestre I' ELSE 'Semestre II' END,
              'pending', v_due, now())
      ON CONFLICT DO NOTHING;

      v_charges  := v_charges + 1;
      v_payments := v_payments + 1;
    END LOOP;

  ELSE
    -- ── Plan mensual: NUNCA se adelanta el año completo. ──
    -- Se genera SOLO el mes actual si hoy ya pasó el día de generación (25).
    -- Antes del 25: el padre no ve ningún cobro (lo genera el ciclo el día 25).
    -- Los meses siguientes los crea auto-payment-cycle / run_payment_cycle
    -- cada día 25 del mes correspondiente.
    IF EXTRACT(DAY FROM v_curr)::int >= v_gen_day
       AND to_char(v_curr, 'YYYY-MM') >= v_start_month
    THEN
      v_month := to_char(v_curr, 'YYYY-MM');

      IF v_month = v_start_month THEN
        -- 1ª mensualidad → vence el día de generación del mes de inicio
        v_due := v_first_due;
      ELSE
        v_due := (to_date(v_month || '-01', 'YYYY-MM-DD')
                  + (v_due_day - 1) * interval '1 day')::date;
      END IF;

      -- Evitar que un cobro creado "tarde" en el mes (tras el 25) nazca
      -- ya vencido con mora. Si el vencimiento cayó antes de hoy, se difiere.
      IF v_due < v_curr THEN v_due := v_curr; END IF;

      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Mensualidad', 'mensualidad',
              COALESCE(p_monthly_amount, 0), v_discount, v_month_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;

      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_month_net, 'Mensualidad', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;

      v_charges  := v_charges + 1;
      v_payments := v_payments + 1;

      IF v_prolong_net > 0 THEN
        INSERT INTO public.student_charges
          (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
        VALUES (p_student_id, 'Día Prolongado', 'prolongado',
                COALESCE(p_prolongado_fee, 0), v_discount, v_prolong_net,
                v_month, v_due, 'pending', auth.uid())
        ON CONFLICT DO NOTHING;

        INSERT INTO public.payments
          (student_id, amount, concept, status, due_date, month_paid, created_at)
        VALUES (p_student_id, v_prolong_net, 'Día Prolongado', 'pending', v_due, v_month, now())
        ON CONFLICT DO NOTHING;

        v_charges  := v_charges + 1;
        v_payments := v_payments + 1;
      END IF;
    END IF;
  END IF;

  UPDATE public.students
     SET monthly_fee    = COALESCE(p_monthly_amount,   monthly_fee),
         prolongado_fee = COALESCE(p_prolongado_fee,   prolongado_fee),
         due_day        = COALESCE(p_due_day,           due_day),
         discount_pct   = v_discount,
         payment_plan   = p_plan
   WHERE id = p_student_id;

  RETURN jsonb_build_object('charges', v_charges, 'payments', v_payments,
                             'plan', p_plan, 'start_month', v_start_month,
                             'first_due', v_first_due::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_period(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_ap record; v_p record; v_legacy bigint;
BEGIN
  SELECT ap.*, sy.name AS school_year_name INTO v_ap
  FROM public.academic_periods ap
  JOIN public.school_years sy ON sy.id = ap.school_year_id
  WHERE ap.is_active = true AND ap.status = 'open'
    AND sy.status IN ('active','enrollment','reenrollment')
  ORDER BY ap.order_index LIMIT 1;
  IF FOUND THEN
    v_legacy := public.resolve_period_id(v_ap.id);
    RETURN jsonb_build_object('found',true,'id',v_legacy,'academic_period_id',v_ap.id,
      'name',v_ap.name,'start_date',v_ap.start_date,'end_date',v_ap.end_date,
      'status',v_ap.status,'is_active',v_ap.is_active,
      'school_year_id',v_ap.school_year_id,'school_year_name',v_ap.school_year_name,
      'order_index',v_ap.order_index,'source','academic_periods');
  END IF;
  IF p_classroom_id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.periods
    WHERE classroom_id = p_classroom_id AND status = 'open' AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_p FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF FOUND THEN
      RETURN jsonb_build_object('found',true,'id',v_p.id,'name',v_p.name,'start_date',v_p.start_date,
        'end_date',v_p.end_date,'status',v_p.status,'is_active',v_p.is_active,'classroom_id',v_p.classroom_id,'source','periods');
    END IF;
  END IF;
  RETURN jsonb_build_object('found',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_school_year()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'status',status,
    'enrollment_start',enrollment_start,'enrollment_end',enrollment_end,
    'reenrollment_start',reenrollment_start,'reenrollment_end',reenrollment_end)
  INTO v_result FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'enrollment' THEN 2 WHEN 'reenrollment' THEN 3 END LIMIT 1;
  RETURN COALESCE(v_result,'{}');
END;
$$;

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

CREATE OR REPLACE FUNCTION public.get_activities_with_grades(p_period_id bigint, p_classroom_id bigint DEFAULT NULL)
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
  WHERE pc.period_id = public.resolve_period_id(p_period_id)
    AND (p_classroom_id IS NULL OR pc.classroom_id = p_classroom_id);
$$;

CREATE OR REPLACE FUNCTION public.get_business_suspension_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.school_settings%ROWTYPE;
  _role text;
BEGIN
  SELECT get_my_role() INTO _role;
  IF _role IS NULL OR _role NOT IN ('admin','directora') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _row FROM public.school_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'status',           _row.status,
    'suspended_at',     _row.suspended_at,
    'suspension_reason', _row.suspension_reason
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.get_current_period()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period periods%ROWTYPE;
BEGIN
  SELECT * INTO v_period FROM public.periods WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN SELECT * INTO v_period FROM public.periods WHERE status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'id',v_period.id,'name',v_period.name,'status',v_period.status,
    'is_active',v_period.is_active,'start_date',v_period.start_date,'end_date',v_period.end_date,'classroom_id',v_period.classroom_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_students     int;
  v_teachers     int;
  v_classrooms   int;
  v_attendance   int;
  v_absent       int;
  v_pending      numeric;
  v_review_count int;
  v_incidents    int;
  v_today        date := current_date;
BEGIN
  v_students   := (SELECT count(*)::int FROM public.students WHERE is_active = true);
  v_teachers   := (SELECT count(*)::int FROM public.profiles WHERE role IN ('maestra','asistente'));
  v_classrooms := (SELECT count(*)::int FROM public.classrooms);

  -- Presentes hoy: registros con estado presente/tarde
  v_attendance := (SELECT count(*)::int FROM public.attendance
                   WHERE date = v_today
                     AND status IN ('present','late','presente','tarde'));

  -- ✅ AUSENTES CORREGIDO: estudiantes activos SIN registro de presente/tarde/retirado hoy
  -- Incluye tanto los marcados como 'absent' como los que aún no tienen registro.
  v_absent := (SELECT count(*)::int FROM public.students s
               WHERE s.is_active = true
                 AND s.classroom_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM public.attendance a
                   WHERE a.student_id = s.id
                     AND a.date = v_today
                     AND a.status IN ('present','late','presente','tarde','retirado')
                 ));

  v_pending    := COALESCE((SELECT sum(amount) FROM public.payments
                            WHERE status IN ('pending','overdue','review','pendiente','vencido')
                              AND deleted_at IS NULL), 0);
  v_review_count := COALESCE((SELECT count(*)::int FROM public.payments
                              WHERE status = 'review' AND deleted_at IS NULL), 0);
  v_incidents  := COALESCE((SELECT count(*)::int FROM public.inquiries WHERE status NOT IN ('resolved','closed')), 0);

  RETURN jsonb_build_object(
    'total',            v_students,
    'active',           v_students,
    'teachers',         v_teachers,
    'classrooms',       v_classrooms,
    'attendance_today', v_attendance,
    'absent_today',     v_absent,
    'pending_payments', v_pending,
    'pending_amount',   v_pending,
    'review_count',     v_review_count,
    'inquiries',        v_incidents
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.get_embajador_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code     public.referral_codes%ROWTYPE;
  v_referrals jsonb;
  v_rewards  jsonb;
  v_balance  numeric(10,2);
  v_enrolled integer;
BEGIN
  SELECT * INTO v_code FROM public.referral_codes WHERE parent_id = auth.uid();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'family', r.referred_family_name,
      'email', r.referred_email,
      'phone', r.referred_phone,
      'status', r.status,
      'reward_status', r.reward_status,
      'discount_amount', r.discount_amount,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC
  ), '[]'::jsonb)
  INTO v_referrals
  FROM public.referrals r WHERE r.referrer_parent_id = auth.uid();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', w.id,
      'reward_type', w.reward_type,
      'amount', w.amount,
      'description', w.description,
      'is_used', w.is_used,
      'created_at', w.created_at
    ) ORDER BY w.created_at DESC
  ), '[]'::jsonb),
  coalesce(sum(w.amount) FILTER (WHERE w.is_used = false), 0),
  count(*) FILTER (WHERE r.status = 'enrolled')
  INTO v_rewards, v_balance, v_enrolled
  FROM public.referral_rewards w
  LEFT JOIN public.referrals r ON r.id = w.referral_id
  WHERE w.parent_id = auth.uid();

  RETURN jsonb_build_object(
    'code', v_code.id IS NOT NULL,
    'code_value', coalesce(v_code.code, null),
    'qr_url', coalesce(v_code.qr_url, null),
    'total_invites', coalesce(v_code.total_invites_sent, 0),
    'enrolled_count', v_enrolled,
    'balance', v_balance,
    'referrals', v_referrals,
    'rewards', v_rewards
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.get_grade_periods()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      text;
  v_ap        record;
  v_legacy    bigint;
  v_name      text;
  v_start     date;
  v_end       date;
  v_status    text;
  v_is_active boolean;
  v_result    jsonb := '[]'::jsonb;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL OR v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_ap IN
    SELECT ap.id, ap.name, ap.start_date, ap.end_date, ap.status, ap.is_active, ap.order_index
    FROM public.academic_periods ap
    ORDER BY ap.order_index, ap.start_date
  LOOP
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
    ELSE
      UPDATE public.periods
      SET status = CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE status END,
          is_active = v_ap.is_active
      WHERE id = v_legacy;
    END IF;

    SELECT status, is_active INTO v_status, v_is_active
    FROM public.periods WHERE id = v_legacy;

    v_result := v_result || jsonb_build_object(
      'id',                 v_legacy,
      'academic_period_id', v_ap.id,
      'name',               v_ap.name,
      'start_date',         v_ap.start_date,
      'end_date',           v_ap.end_date,
      'status',             v_status,
      'is_active',          v_is_active,
      'order_index',        v_ap.order_index
    );
  END LOOP;

  -- Periodos legacy huerfanos (sin contraparte en academic_periods)
  FOR v_legacy IN
    SELECT p.id FROM public.periods p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academic_periods ap
      WHERE ap.name = p.name AND ap.start_date = p.start_date AND ap.end_date = p.end_date
    )
    ORDER BY p.start_date, p.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) e WHERE (e->>'id')::bigint = v_legacy) THEN
      SELECT name, start_date, end_date, status, is_active
        INTO v_name, v_start, v_end, v_status, v_is_active
      FROM public.periods WHERE id = v_legacy;

      v_result := v_result || jsonb_build_object(
        'id', v_legacy, 'academic_period_id', NULL,
        'name', v_name, 'start_date', v_start, 'end_date', v_end,
        'status', v_status, 'is_active', v_is_active, 'order_index', 0
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.get_login_series()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_role text;
  v_daily jsonb;
  v_hour  jsonb;
  v_hour_today jsonb;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'directora' AND v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/admin';
  END IF;

  -- Diario por rol (últimos 7 días)
  SELECT COALESCE(jsonb_agg(row_item), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT jsonb_build_object(
      'day',       d.day,
      'rol',       COALESCE(p.role, 'sin_perfil'),
      'count',     g.n
    ) AS row_item
    FROM (
      SELECT created_at::date AS day, email, count(*) AS n
      FROM public.login_attempts
      WHERE success AND created_at >= now() - INTERVAL '7 days'
      GROUP BY 1, 2
    ) g
    LEFT JOIN public.profiles p ON lower(p.email) = lower(g.email)
    RIGHT JOIN LATERAL generate_series(current_date - 6, current_date, interval '1 day') AS d(day)
      ON d.day = g.day
  ) t;

  -- Horaria (últimos 7 días)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::jsonb) INTO v_hour
  FROM (
    SELECT EXTRACT(hour FROM created_at)::int AS h, count(*) AS n
    FROM public.login_attempts
    WHERE success AND created_at >= now() - INTERVAL '7 days'
    GROUP BY 1
  ) t;

  -- Horaria (hoy)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hour', h, 'count', n) ORDER BY h), '[]'::jsonb) INTO v_hour_today
  FROM (
    SELECT EXTRACT(hour FROM created_at)::int AS h, count(*) AS n
    FROM public.login_attempts
    WHERE success AND created_at >= current_date::timestamptz
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'daily',       v_daily,
    'hourly',      v_hour,
    'hourly_today', v_hour_today
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_login_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_role      text;
  v_7d_start  timestamptz := now() - INTERVAL '7 days';
  v_30d_start timestamptz := now() - INTERVAL '30 days';
  v_today     date := current_date;
  v_tot7      bigint;
  v_tot30     bigint;
  v_today_n   bigint;
  v_users7    bigint;
  v_users30   bigint;
  v_peak_hour int;
  v_result    jsonb;
BEGIN
  SELECT get_my_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'directora' AND v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/admin';
  END IF;

  SELECT count(*) INTO v_tot7   FROM public.login_attempts WHERE success AND created_at >= v_7d_start;
  SELECT count(*) INTO v_tot30  FROM public.login_attempts WHERE success AND created_at >= v_30d_start;
  SELECT count(*) INTO v_today_n FROM public.login_attempts WHERE success AND created_at >= v_today::timestamptz;
  SELECT count(DISTINCT email)  INTO v_users7  FROM public.login_attempts WHERE success AND created_at >= v_7d_start;
  SELECT count(DISTINCT email)  INTO v_users30 FROM public.login_attempts WHERE success AND created_at >= v_30d_start;

  SELECT EXTRACT(hour FROM created_at)::int INTO v_peak_hour
  FROM public.login_attempts
  WHERE success AND created_at >= v_7d_start
  GROUP BY EXTRACT(hour FROM created_at)
  ORDER BY count(*) DESC
  LIMIT 1;

  -- Per-user agregado (7d / 30d / último acceso / hora más frecuente)
  SELECT COALESCE(jsonb_agg(u ORDER BY u->>'l7' DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'user_id', p.id,
      'name',    COALESCE(p.name, split_part(la.email, '@', 1)),
      'email',   la.email,
      'role',    COALESCE(p.role, 'sin_perfil'),
      'l7',      count(*) FILTER (WHERE la.created_at >= v_7d_start),
      'l30',     count(*) FILTER (WHERE la.created_at >= v_30d_start),
      'last_login', (extract(epoch FROM max(la.created_at)) * 1000)::bigint,
      'peak_hour', (
        SELECT EXTRACT(hour FROM x.created_at)::text
        FROM public.login_attempts x
        WHERE x.email = la.email AND x.success
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
      )
    ) u
    FROM public.login_attempts la
    LEFT JOIN public.profiles p ON lower(p.email) = lower(la.email)
    WHERE la.success AND la.created_at >= v_30d_start
    GROUP BY la.email, p.id, p.name, p.role
  ) t;

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'logins_7d',    v_tot7,
      'logins_30d',   v_tot30,
      'logins_today', v_today_n,
      'users_7d',     v_users7,
      'users_30d',    v_users30,
      'peak_hour',    v_peak_hour
    ),
    'users', v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_classroom_ids()
RETURNS table(ret_id bigint) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select s.classroom_id::bigint from public.students s
  where s.parent_id = auth.uid() and s.classroom_id is not null and s.deleted_at is null;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;

CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint, p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
  WHERE pc.period_id = public.resolve_period_id(p_period_id)
    AND (p_classroom_id IS NULL OR pc.classroom_id = p_classroom_id);
$$;

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

CREATE OR REPLACE FUNCTION public.get_posts_for_period(
  p_classroom_id bigint DEFAULT NULL, p_period_id bigint DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL AND p_classroom_id IS NOT NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',p.id,'content',p.content,'media_url',p.media_url,'media_type',p.media_type,
    'image_url',p.image_url,'created_at',p.created_at,'classroom_id',p.classroom_id,'teacher_id',p.teacher_id,'period_id',p.period_id,
    'teacher',jsonb_build_object('name',COALESCE(pr.name,p.teacher_name,'Maestra'),'avatar_url',COALESCE(pr.avatar_url,p.teacher_avatar),'role',pr.role),
    'likes',COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',l.user_id,'id',l.id)) FROM public.likes l WHERE l.post_id = p.id),'[]'),
    'comments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'content',c.content,'user_name',c.user_name,'user_id',c.user_id,'created_at',c.created_at) ORDER BY c.created_at) FROM public.comments c WHERE c.post_id = p.id),'[]'))
    ORDER BY p.created_at DESC) INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE (p.classroom_id = p_classroom_id OR p.classroom_id IS NULL)
    AND (v_period_id IS NULL OR p.period_id = v_period_id OR
      (p.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods per WHERE per.id = v_period_id AND p.created_at BETWEEN per.start_date AND per.end_date + INTERVAL '1 day')))
  LIMIT p_limit;
  RETURN jsonb_build_object('posts',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_school_year_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_year record; v_today date := CURRENT_DATE;
  v_enrollment_open boolean := false; v_reenrollment_open boolean := false;
  v_active_period jsonb; v_days_remaining integer; v_ap_count int;
BEGIN
  SELECT * INTO v_year FROM public.school_years WHERE status IN ('active','enrollment','reenrollment') LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_year FROM public.school_years WHERE status = 'draft' ORDER BY id DESC LIMIT 1;
    IF FOUND THEN UPDATE public.school_years SET status='active', updated_at=now() WHERE id = v_year.id; END IF;
  END IF;
  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_ap_count FROM public.academic_periods;
    IF v_ap_count > 0 THEN RETURN jsonb_build_object('has_active_year',false,'status','orphan_periods','orphan_count',v_ap_count); END IF;
    RETURN jsonb_build_object('has_active_year',false,'status','none','message','No hay año escolar configurado');
  END IF;
  IF v_year.enrollment_start IS NOT NULL AND v_year.enrollment_end IS NOT NULL THEN
    v_enrollment_open := v_today BETWEEN v_year.enrollment_start AND v_year.enrollment_end;
  END IF;
  IF v_year.reenrollment_start IS NOT NULL AND v_year.reenrollment_end IS NOT NULL THEN
    v_reenrollment_open := v_today BETWEEN v_year.reenrollment_start AND v_year.reenrollment_end;
  END IF;
  v_active_period := public.get_active_period();
  v_days_remaining := GREATEST(0,(v_year.end_date - v_today)::int);
  RETURN jsonb_build_object(
    'has_active_year',true,'school_year_id',v_year.id,'school_year_name',v_year.name,
    'status',v_year.status,'start_date',v_year.start_date,'end_date',v_year.end_date,
    'enrollment_open',v_enrollment_open,'enrollment_window',jsonb_build_object('start',v_year.enrollment_start,'end',v_year.enrollment_end),
    'reenrollment_open',v_reenrollment_open,'reenrollment_window',jsonb_build_object('start',v_year.reenrollment_start,'end',v_year.reenrollment_end),
    'active_period',v_active_period,'days_remaining',v_days_remaining,
    'is_school_time',v_year.status = 'active' AND v_today BETWEEN v_year.start_date AND v_year.end_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_boletin(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id    uuid;
  v_role       text;
  v_student    record;
  v_period     record;
  v_area       record;
  v_count      int;
  v_avg        numeric(5,2);
  v_total      numeric(5,2) := 0;
  v_area_count int := 0;
  v_level      text;
  v_areas      jsonb := '[]'::jsonb;
  v_acts       jsonb;
  v_report     record;
  v_att        record;
  v_pct        numeric(5,2);
  v_directora  text;
  v_year       text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = p_student_id AND parent_id = v_user_id
    ) THEN
      RETURN jsonb_build_object('error', 'Acceso denegado');
    END IF;
  END IF;

  SELECT s.id, s.name, s.matricula, s.age, s.age_type, s.avatar_url,
         s.birth_date,
         s.classroom_id, c.name AS classroom_name, c.level AS classroom_level,
         t.name AS teacher_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.classrooms c ON c.id = s.classroom_id
  LEFT JOIN public.profiles t ON t.id = c.teacher_id
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Estudiante no encontrado');
  END IF;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Periodo no encontrado');
  END IF;

  SELECT name INTO v_directora
  FROM public.profiles
  WHERE role = 'directora'
  ORDER BY created_at
  LIMIT 1;

  SELECT name INTO v_year
  FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY created_at DESC
  LIMIT 1;

  -- Areas configuradas en el periodo con promedio en tiempo real
  FOR v_area IN
    SELECT pc.subject_id, s.name AS subject_name, pc.activity_count
    FROM public.period_config pc
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE pc.period_id = p_period_id
    ORDER BY s.name
  LOOP
    SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0)) INTO v_count
    FROM (
      SELECT COUNT(*) AS a_cnt
      FROM public.grades g
      JOIN public.activities a ON a.id = g.activity_id
      JOIN public.period_config pc ON pc.id = a.config_id
      WHERE pc.period_id = p_period_id
        AND pc.subject_id = v_area.subject_id
        AND g.student_id = p_student_id
        AND g.score_v2 IS NOT NULL
    ) a, (
      SELECT COUNT(*) AS t_cnt
      FROM public.task_evidences te
      JOIN public.tasks t ON t.id = te.task_id
      JOIN public.period_config pc ON pc.id = t.config_id
      WHERE pc.period_id = p_period_id
        AND pc.subject_id = v_area.subject_id
        AND te.student_id = p_student_id
        AND te.score_v2 IS NOT NULL
    ) b;

    IF v_count >= 5 THEN
      SELECT ROUND(AVG(score_v2), 2) INTO v_avg
      FROM (
        SELECT g.score_v2
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id
          AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2
        FROM public.task_evidences te
        JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id
          AND te.score_v2 IS NOT NULL
        ORDER BY score_v2 DESC
        LIMIT 5
      ) best_scores;
    ELSE
      SELECT ROUND(AVG(score_v2), 2) INTO v_avg
      FROM (
        SELECT g.score_v2
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id
          AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2
        FROM public.task_evidences te
        JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id
          AND te.score_v2 IS NOT NULL
      ) all_scores;
    END IF;

    IF v_avg IS NOT NULL THEN
      v_total := v_total + v_avg;
      v_area_count := v_area_count + 1;
    END IF;

    v_areas := v_areas || jsonb_build_object(
      'subject_id',     v_area.subject_id,
      'subject_name',   v_area.subject_name,
      'activity_count', v_area.activity_count,
      'graded_count',   v_count,
      'average',        v_avg,
      'method',         CASE WHEN v_count >= 5 THEN 'best_5' ELSE 'all' END
    );
  END LOOP;

  -- Detalle de actividades y tareas calificadas del estudiante
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'subject_id',      x.subject_id,
        'subject_name',    x.subject_name,
        'activity_id',     x.activity_id,
        'activity_title',  x.activity_title,
        'activity_number', x.activity_number,
        'score',           x.score,
        'comment',         x.comment,
        'is_task',         x.is_task
      )
      ORDER BY x.subject_name, x.activity_number
    ),
    '[]'::jsonb
  ) INTO v_acts
  FROM (
    SELECT pc.subject_id, s.name AS subject_name, a.id AS activity_id, a.title AS activity_title,
           a.activity_number, g.score_v2 AS score, g.notes AS comment, false AS is_task
    FROM public.grades g
    JOIN public.activities a ON a.id = g.activity_id
    JOIN public.period_config pc ON pc.id = a.config_id
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE g.student_id = p_student_id
      AND pc.period_id = p_period_id
      AND g.score_v2 IS NOT NULL
    UNION ALL
    SELECT pc.subject_id, s.name AS subject_name, NULL::bigint AS activity_id, t.title AS activity_title,
           999::int AS activity_number, te.score_v2 AS score, te.comment AS comment, true AS is_task
    FROM public.task_evidences te
    JOIN public.tasks t ON t.id = te.task_id
    JOIN public.period_config pc ON pc.id = t.config_id
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE te.student_id = p_student_id
      AND pc.period_id = p_period_id
      AND te.score_v2 IS NOT NULL
  ) x;

  IF v_area_count > 0 THEN
    v_total := ROUND(v_total / v_area_count, 2);
  ELSE
    v_total := NULL;
  END IF;

  v_level := CASE
    WHEN v_total IS NULL THEN 'Sin calificar'
    WHEN v_total >= 90   THEN 'Excelente'
    WHEN v_total >= 80   THEN 'Bueno'
    WHEN v_total >= 70   THEN 'En proceso'
    ELSE                      'Requiere apoyo'
  END;

  SELECT * INTO v_report
  FROM public.report_cards
  WHERE student_id = p_student_id AND period_id = p_period_id;

  -- Asistencia del estudiante dentro del rango de fechas del periodo
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('present','retirado','late'))  AS asistidos,
    COUNT(*) FILTER (WHERE a.status = 'absent')                        AS ausencias,
    COUNT(*) FILTER (WHERE a.status = 'late')                          AS tardanzas,
    COUNT(*)                                                            AS total
  INTO v_att
  FROM public.attendance a
  WHERE a.student_id = p_student_id
    AND (v_period.start_date IS NULL OR a.date >= v_period.start_date)
    AND (v_period.end_date IS NULL OR a.date <= v_period.end_date);

  v_pct := CASE
    WHEN v_att.total > 0
      THEN ROUND(v_att.asistidos::numeric / v_att.total * 100, 1)
    ELSE NULL END;

  RETURN jsonb_build_object(
    'student', jsonb_build_object(
      'id',         v_student.id,
      'name',       v_student.name,
      'matricula',  v_student.matricula,
      'age',        v_student.age,
      'age_type',   v_student.age_type,
      'birth_date', v_student.birth_date,
      'avatar_url', v_student.avatar_url
    ),
    'classroom', jsonb_build_object(
      'id',    v_student.classroom_id,
      'name',  v_student.classroom_name,
      'level', v_student.classroom_level
    ),
    'teacher_name',    v_student.teacher_name,
    'directora_name',  v_directora,
    'school_year_name',v_year,
    'period', jsonb_build_object(
      'id',          v_period.id,
      'name',        v_period.name,
      'start_date',  v_period.start_date,
      'end_date',    v_period.end_date,
      'status',      v_period.status,
      'is_active',   v_period.is_active
    ),
    'areas', v_areas,
    'activities', v_acts,
    'overall_average', v_total,
    'level', v_level,
    'attendance', jsonb_build_object(
      'asistencias',  v_att.asistidos,
      'ausencias',    v_att.ausencias,
      'tardanzas',    v_att.tardanzas,
      'total',        v_att.total,
      'pct',          v_pct
    ),
    'issued_at', CURRENT_DATE,
    'report', CASE WHEN v_report.id IS NOT NULL THEN
      jsonb_build_object(
        'final_score',      v_report.final_score,
        'level',            v_report.level,
        'teacher_comment',  v_report.teacher_comment,
        'directora_comment',v_report.directora_comment,
        'conducta',         v_report.conducta,
        'fortalezas',       COALESCE(v_report.fortalezas, '{}'),
        'debilidades',      COALESCE(v_report.debilidades, '{}'),
        'generated_at',     v_report.generated_at
      )
    ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_family_rank(p_student_id bigint)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent uuid;
  v_email  text;
  v_rank   int;
BEGIN
  SELECT parent_id, lower(trim(p1_email)) INTO v_parent, v_email
  FROM public.students WHERE id = p_student_id;

  IF v_parent IS NULL AND (v_email IS NULL OR v_email = '') THEN
    RETURN 1;
  END IF;

  WITH family AS (
    SELECT s.id
    FROM public.students s
    WHERE s.is_active = TRUE
      AND s.deleted_at IS NULL
      AND (
        (v_parent IS NOT NULL AND s.parent_id = v_parent)
        OR (v_email IS NOT NULL AND v_email <> '' AND lower(trim(s.p1_email)) = v_email)
      )
  ),
  ranked AS (
    SELECT f.id,
           ROW_NUMBER() OVER (
             ORDER BY (SELECT s.start_date FROM public.students s WHERE s.id = f.id) NULLS LAST,
                      f.id
           ) AS rn
    FROM family f
  )
  SELECT rn INTO v_rank FROM ranked WHERE id = p_student_id;

  RETURN COALESCE(v_rank, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_grades_v2(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY subject_name, activity_number),'[]')
  FROM (
    SELECT g.activity_id, g.score_v2 AS score, s.name AS subject_name, a.title AS activity_title,
           a.activity_number, g.notes AS comment, false AS is_task
    FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
    JOIN public.period_config pc ON pc.id = a.config_id JOIN public.subjects s ON s.id = pc.subject_id
    WHERE g.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND g.score_v2 IS NOT NULL
    UNION ALL
    SELECT NULL::bigint AS activity_id, te.score_v2 AS score, s.name AS subject_name, t.title AS activity_title,
           999::int AS activity_number, te.comment AS comment, true AS is_task
    FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
    JOIN public.period_config pc ON pc.id = t.config_id JOIN public.subjects s ON s.id = pc.subject_id
    WHERE te.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND te.score_v2 IS NOT NULL
  ) row;
$$;

CREATE OR REPLACE FUNCTION public.get_student_history(p_student_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_name',p.name,'classroom_name',c.name,
    'task_avg',rc.task_avg,'formal_avg',rc.formal_avg,'final_score',rc.final_score,
    'level',rc.level,'teacher_comment',rc.teacher_comment,'generated_at',rc.generated_at)
    ORDER BY p.start_date DESC),'[]')
  FROM public.report_cards rc JOIN public.periods p ON p.id = rc.period_id
  LEFT JOIN public.classrooms c ON c.id = rc.classroom_id WHERE rc.student_id = p_student_id;
$$;

CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_id bigint;
  v_area      record;
  v_count     int;
  v_avg       numeric(5,2);
  v_result    jsonb := '[]'::jsonb;
BEGIN
  -- Promedio por materia EN TIEMPO REAL (grades + task_evidences), misma
  -- lógica del boletín (mejores 5 si hay 5+ notas). Antes solo aparecía al
  -- cerrar el período (subject_averages), dejando "Sin calificar" en curso.
  v_period_id := public.resolve_period_id(p_period_id);

  FOR v_area IN
    SELECT pc.subject_id, s.name AS subject_name
    FROM public.period_config pc
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE pc.period_id = v_period_id
    ORDER BY s.name
  LOOP
    SELECT (COALESCE(a_cnt,0) + COALESCE(t_cnt,0)) INTO v_count
    FROM (
      SELECT COUNT(*) AS a_cnt
      FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
      JOIN public.period_config pc ON pc.id = a.config_id
      WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
        AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
    ) a, (
      SELECT COUNT(*) AS t_cnt
      FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
      JOIN public.period_config pc ON pc.id = t.config_id
      WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
        AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
    ) b;

    IF v_count = 0 THEN CONTINUE; END IF;

    IF v_count >= 5 THEN
      SELECT ROUND(AVG(sv),2) INTO v_avg FROM (
        SELECT g.score_v2 AS sv
        FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2 AS sv
        FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
        ORDER BY sv DESC
        LIMIT 5
      ) best_scores;
    ELSE
      SELECT ROUND(AVG(sv),2) INTO v_avg FROM (
        SELECT g.score_v2 AS sv
        FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id AND g.score_v2 IS NOT NULL
        UNION ALL
        SELECT te.score_v2 AS sv
        FROM public.task_evidences te JOIN public.tasks t ON t.id = te.task_id
        JOIN public.period_config pc ON pc.id = t.config_id
        WHERE pc.period_id = v_period_id AND pc.subject_id = v_area.subject_id
          AND te.student_id = p_student_id AND te.score_v2 IS NOT NULL
      ) all_scores;
    END IF;

    v_result := v_result || jsonb_build_object(
      'subject_name', v_area.subject_name,
      'average',      v_avg,
      'graded_count', v_count,
      'method',       CASE WHEN v_count >= 5 THEN 'best_5' ELSE 'all' END
    );
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tasks_for_period(p_classroom_id bigint, p_period_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'due_date',t.due_date,
    'file_url',t.file_url,'grading_system',t.grading_system,'classroom_id',t.classroom_id,'period_id',t.period_id,'created_at',t.created_at)
    ORDER BY t.due_date ASC) INTO v_result
  FROM public.tasks t
  WHERE t.classroom_id = p_classroom_id
    AND (v_period_id IS NULL OR t.period_id = v_period_id OR
      (t.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods p WHERE p.id = v_period_id AND t.created_at BETWEEN p.start_date AND p.end_date + INTERVAL '1 day')));
  RETURN jsonb_build_object('tasks',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.increment_post_views(p_post_id bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.posts
    SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = p_post_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_referral_count(p_code_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.referral_codes
    SET total_invites_sent = total_invites_sent + 1
  WHERE id = p_code_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_subject(
    p_name            text,
    p_education_level text DEFAULT NULL,
    p_description     text DEFAULT NULL,
    p_classroom_id    bigint DEFAULT NULL
  )
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_role text;
    v_row  public.subjects%ROWTYPE;
  BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role NOT IN ('directora','asistente','admin') THEN
      RETURN jsonb_build_object('error', 'Solo directora/asistente pueden crear áreas');
    END IF;

    IF p_classroom_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE id = p_classroom_id) THEN
      RETURN jsonb_build_object('error', 'El aula seleccionada no existe');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.subjects
      WHERE name = btrim(p_name)
        AND ((p_classroom_id IS NULL AND classroom_id IS NULL)
            OR (p_classroom_id IS NOT NULL AND classroom_id = p_classroom_id))
    ) THEN
      RETURN jsonb_build_object('error', CASE WHEN p_classroom_id IS NOT NULL
        THEN 'Ya existe un área con ese nombre en este aula'
        ELSE 'Ya existe un área con ese nombre' END);
    END IF;

    INSERT INTO public.subjects (name, education_level, description, is_active, classroom_id)
    VALUES (btrim(p_name), p_education_level, p_description, true, p_classroom_id)
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name);
  END;
  $$;

CREATE OR REPLACE FUNCTION public.is_business_suspended()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.school_settings WHERE id = 1;
  RETURN COALESCE(_status, 'active') = 'suspended';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_classroom_accessible(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = p_classroom_id AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.classroom_id = p_classroom_id
                 AND s.deleted_at IS NULL
                 AND public.is_family_member(s.id));
$$;

CREATE OR REPLACE FUNCTION public.is_email_under_attack(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) >= 10 FROM public.login_attempts
  WHERE email = p_email AND success = false AND created_at > NOW() - INTERVAL '1 hour';
$$;

CREATE OR REPLACE FUNCTION public.is_family_member(p_student_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students target
    WHERE target.id = p_student_id
      AND target.deleted_at IS NULL
      AND (
        -- 1) Tutor directo
        target.parent_id = auth.uid()

        -- 2) Comparte email/cédula de tutor con un estudiante del padre
        OR EXISTS (
          SELECT 1 FROM public.students mine
          WHERE mine.deleted_at IS NULL
            AND mine.parent_id = auth.uid()
            AND (
              ( lower(trim(coalesce(mine.p1_email,''))) <> ''
                AND lower(trim(coalesce(mine.p1_email,''))) IN
                    (lower(trim(coalesce(target.p1_email,''))), lower(trim(coalesce(target.p2_email,'')))) )
              OR ( lower(trim(coalesce(mine.p2_email,''))) <> ''
                   AND lower(trim(coalesce(mine.p2_email,''))) IN
                       (lower(trim(coalesce(target.p1_email,''))), lower(trim(coalesce(target.p2_email,'')))) )
              OR ( regexp_replace(coalesce(mine.p1_cedula,''),'\D','','g') <> ''
                   AND regexp_replace(coalesce(mine.p1_cedula,''),'\D','','g') IN
                       (regexp_replace(coalesce(target.p1_cedula,''),'\D','','g'),
                        regexp_replace(coalesce(target.p2_cedula,''),'\D','','g')) )
              OR ( regexp_replace(coalesce(mine.p2_cedula,''),'\D','','g') <> ''
                   AND regexp_replace(coalesce(mine.p2_cedula,''),'\D','','g') IN
                       (regexp_replace(coalesce(target.p1_cedula,''),'\D','','g'),
                        regexp_replace(coalesce(target.p2_cedula,''),'\D','','g')) )
            )
        )

        -- 3) Vínculo directo por sibling_id (cualquier dirección)
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.deleted_at IS NULL
            AND s.parent_id = auth.uid()
            AND (s.sibling_id = target.id OR (target.sibling_id IS NOT NULL AND target.sibling_id = s.id))
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_grade_accessible(p_classroom_id bigint, p_activity_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR (p_classroom_id IS NOT NULL AND public.is_classroom_accessible(p_classroom_id))
    OR (p_activity_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.activities a
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE a.id = p_activity_id AND pc.classroom_id IS NOT NULL
          AND public.is_classroom_accessible(pc.classroom_id)
      ));
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_classroom(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.students where classroom_id = p_classroom_id and parent_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_parent_of_student(p_student_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.students where id = p_student_id and parent_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_period_open(p_period_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.periods WHERE id = p_period_id AND status = 'open');
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_of_classroom(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (select 1 from public.classrooms where id = p_classroom_id and teacher_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_of_student(p_student_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (
    select 1 from public.students s
    join public.classrooms c on c.id = s.classroom_id
    where s.id = p_student_id and c.teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.log_audit_change(
    p_action text,
    p_table_name text,
    p_record_id bigint,
    p_classroom_id bigint,
    p_old_value jsonb DEFAULT NULL,
    p_new_value jsonb DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'
  )
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, classroom_id, old_value, new_value, metadata)
    VALUES (auth.uid(), p_action, p_table_name, p_record_id, p_classroom_id, p_old_value, p_new_value, p_metadata);
  END;
  $$;

CREATE OR REPLACE FUNCTION public.log_business_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (user_id, action, payload)
    VALUES (
      auth.uid(),
      'business.status_change',
      jsonb_build_object(
        'from',   OLD.status,
        'to',     NEW.status,
        'by',     auth.uid(),
        'at',     NEW.suspended_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.mark_absent_students()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date      := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_local_time  time      := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_settings    record;
  v_threshold   time;
  v_work_days   text[]    := ARRAY['Lun','Mar','Mié','Jue','Vie'];
  v_dow_name    text;
  v_student     record;
  v_att         record;
  v_reason      text;
  v_note        text;
  v_marked      integer   := 0;
  v_parents     uuid[]    := '{}';
  v_students    jsonb     := '[]'::jsonb;
BEGIN
  -- 1) Configuración del centro: hora límite de entrada + días laborables
  SELECT check_in_end, open_time, work_days INTO v_settings
  FROM public.school_settings WHERE id = 1;

  IF v_settings.work_days IS NOT NULL THEN
    BEGIN
      v_work_days := ARRAY(
        SELECT elem::text
        FROM jsonb_array_elements_text(v_settings.work_days::jsonb) AS elem
      );
    EXCEPTION WHEN OTHERS THEN
      v_work_days := ARRAY['Lun','Mar','Mié','Jue','Vie'];
    END;
  END IF;

  -- 2) Umbral = límite de entrada + 2 horas. Si no hay límite explícito, se usa la apertura.
  -- open_time es text ("07:00") y check_in_end es time → cast a time para que COALESCE no falle (42804).
  v_threshold := COALESCE(v_settings.check_in_end, (v_settings.open_time)::time) + interval '2 hours';

  IF v_threshold IS NULL THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 3) Todavía no ha pasado el umbral: no marcar ausentes
  IF v_local_time < v_threshold THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 4) ¿Es día laborable?
  v_dow_name := CASE extract(dow FROM v_today)
    WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar'
    WHEN 3 THEN 'Mié' WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie' WHEN 6 THEN 'Sáb'
  END;

  IF NOT (v_dow_name = ANY(v_work_days)) THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 5) Marcar como ausentes a los estudiantes activos sin llegada
  FOR v_student IN
    SELECT id, classroom_id, name, parent_id
    FROM public.students
    WHERE is_active = true
      AND classroom_id IS NOT NULL
    ORDER BY id
  LOOP
    -- Motivo de ausencia si el padre ya la reportó (attendance_requests)
    v_reason := NULL; v_note := NULL;
    SELECT reason, note INTO v_reason, v_note
    FROM public.attendance_requests
    WHERE student_id = v_student.id AND date = v_today
      AND coalesce(status, '') IN ('pending', 'approved')
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    SELECT * INTO v_att
    FROM public.attendance
    WHERE student_id = v_student.id AND date = v_today;

    IF v_att.id IS NULL THEN
      -- Sin registro de hoy → crear como ausente
      INSERT INTO public.attendance (student_id, classroom_id, date, status, school_year_id, absence_reason)
      VALUES (v_student.id, v_student.classroom_id, v_today, 'absent',
              (SELECT id FROM public.school_years WHERE status = 'active' ORDER BY id DESC LIMIT 1),
              v_reason)
      ON CONFLICT (student_id, date) DO NOTHING;
      IF FOUND THEN
        v_marked := v_marked + 1;
        IF v_student.parent_id IS NOT NULL AND NOT (v_student.parent_id = ANY(v_parents)) THEN
          v_parents := array_append(v_parents, v_student.parent_id);
        END IF;
        v_students := v_students || jsonb_build_object(
          'student_id', v_student.id, 'name', v_student.name, 'parent_id', v_student.parent_id,
          'reason', v_reason, 'note', v_note, 'absence_reason', v_reason
        );
      END IF;
    ELSIF coalesce(v_att.status, '__unmarked__') NOT IN ('present','late','retirado','absent') THEN
      -- Registro existente sin llegada (p. ej. marcado pendiente) → ausente
      UPDATE public.attendance
      SET status = 'absent', absence_reason = v_reason
      WHERE id = v_att.id;
      v_marked := v_marked + 1;
      IF v_student.parent_id IS NOT NULL AND NOT (v_student.parent_id = ANY(v_parents)) THEN
        v_parents := array_append(v_parents, v_student.parent_id);
      END IF;
      v_students := v_students || jsonb_build_object(
        'student_id', v_student.id, 'name', v_student.name, 'parent_id', v_student.parent_id,
        'reason', v_reason, 'note', v_note, 'absence_reason', v_reason
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked', v_marked,
    'parents', to_jsonb(v_parents),
    'students', v_students
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_my_id uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL OR p_conversation_id IS NULL THEN RETURN; END IF;
  UPDATE public.messages
  SET is_read = true, read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_my_id
    AND (is_read IS NULL OR is_read = false);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.preview_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_target_month text; v_gen_count int := 0; v_total_amount numeric := 0;
  v_grace_count int := 0; v_existing_count int := 0;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  v_target_month := to_char(current_date, 'YYYY-MM');
  WITH to_bill AS (
    SELECT s.id, s.monthly_fee, s.prolongado_fee, COALESCE(s.discount_pct,0) AS discount_pct
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.deleted_at IS NULL
      )
  ),
  ranked AS (
    SELECT t.id,
           t.monthly_fee,
           t.prolongado_fee,
           t.discount_pct,
           public.get_student_family_rank(t.id) AS family_rank
    FROM to_bill t
  ),
  with_amount AS (
    SELECT round((monthly_fee * (1 - eff.disc))::numeric, 2) + coalesce(prolongado_fee, 0) AS bill
    FROM ranked,
    LATERAL (
      SELECT GREATEST(
        CASE WHEN family_rank >= 3 THEN 0.15
             WHEN family_rank = 2 THEN 0.10
             ELSE 0 END,
        LEAST(discount_pct, 100) / 100
      ) AS disc
    ) eff
  )
  SELECT count(*), coalesce(sum(bill), 0) INTO v_gen_count, v_total_amount FROM with_amount;

  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments WHERE month_paid = v_target_month AND deleted_at IS NULL;

  RETURN jsonb_build_object('target_month', v_target_month, 'count', v_gen_count,
    'total_amount', v_total_amount, 'existing_count', v_existing_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
  v_limit    time;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success',false,'message','Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    -- Límite de entrada desde el horario configurado
    -- open_time es text ("07:00") y check_in_end es time → cast a time para que COALESCE no falle (42804).
    v_limit := COALESCE(v_settings.check_in_end, (v_settings.open_time)::time);
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_limit IS NOT NULL AND v_local_time > v_limit THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out'; v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'status', v_status, 'student_id', v_student.id, 'parent_id', v_parent,
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

CREATE OR REPLACE FUNCTION public.register_donation(
  p_campaign_id     BIGINT DEFAULT NULL,
  p_donor_name      TEXT   DEFAULT NULL,
  p_donor_email     TEXT   DEFAULT NULL,
  p_donor_phone     TEXT   DEFAULT NULL,
  p_donor_tax_id    TEXT   DEFAULT NULL,
  p_is_company      BOOLEAN DEFAULT false,
  p_is_anonymous    BOOLEAN DEFAULT false,
  p_amount          NUMERIC DEFAULT 0,
  p_payment_method  TEXT   DEFAULT 'transfer',
  p_bank_name       TEXT   DEFAULT NULL,
  p_receipt_url     TEXT   DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref          TEXT;
  v_donation_id  UUID;
  v_name         TEXT;
  v_email        TEXT;
  v_method       TEXT;
BEGIN
  -- Validaciones de entrada
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto de donación inválido';
  END IF;
  IF p_amount > 1000000 THEN
    RAISE EXCEPTION 'Monto excede el límite permitido';
  END IF;

  v_name := nullif(trim(p_donor_name), '');
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Nombre del donante requerido';
  END IF;

  v_email := lower(nullif(trim(p_donor_email), ''));
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo electrónico inválido';
  END IF;

  v_method := nullif(trim(p_payment_method), '');
  IF v_method IS NULL OR v_method NOT IN ('transfer','card','cash') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.donation_campaigns c
    WHERE c.id = p_campaign_id AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Campaña no válida o inactiva';
  END IF;

  -- Referencia única de seguimiento: DON-YYYY-XXXXXX
  LOOP
    v_ref := 'DON-' || to_char(now(), 'YYYY') || '-'
             || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.donations WHERE tracking_ref = v_ref);
  END LOOP;

  INSERT INTO public.donations (
    tracking_ref, campaign_id, donor_name, donor_email, donor_phone,
    donor_tax_id, is_company, is_anonymous, amount, payment_method,
    bank_name, receipt_url, status
  ) VALUES (
    v_ref, p_campaign_id, v_name, v_email, nullif(trim(p_donor_phone), ''),
    nullif(trim(p_donor_tax_id), ''), coalesce(p_is_company, false),
    coalesce(p_is_anonymous, false), p_amount, v_method,
    nullif(trim(p_bank_name), ''), nullif(trim(p_receipt_url), ''), 'pending'
  ) RETURNING id INTO v_donation_id;

  RETURN jsonb_build_object(
    'success',       true,
    'donation_id',   v_donation_id,
    'tracking_ref',  v_ref,
    'amount',        p_amount,
    'currency',      'DOP',
    'message',       'Donación registrada correctamente'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_donation(
  p_campaign_id     BIGINT DEFAULT NULL,
  p_donor_name      TEXT   DEFAULT NULL,
  p_donor_email     TEXT   DEFAULT NULL,
  p_donor_phone     TEXT   DEFAULT NULL,
  p_donor_tax_id    TEXT   DEFAULT NULL,
  p_is_company      BOOLEAN DEFAULT false,
  p_is_anonymous    BOOLEAN DEFAULT false,
  p_amount          NUMERIC DEFAULT 0,
  p_payment_method  TEXT   DEFAULT 'transfer',
  p_bank_name       TEXT   DEFAULT NULL,
  p_receipt_url     TEXT   DEFAULT NULL,
  p_frequency       TEXT   DEFAULT 'one_time'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref          TEXT;
  v_donation_id  UUID;
  v_name         TEXT;
  v_email        TEXT;
  v_method       TEXT;
  v_freq         TEXT;
BEGIN
  -- Validaciones de entrada
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto de donación inválido';
  END IF;
  IF p_amount > 1000000 THEN
    RAISE EXCEPTION 'Monto excede el límite permitido';
  END IF;

  v_name := nullif(trim(p_donor_name), '');
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Nombre del donante requerido';
  END IF;

  v_email := lower(nullif(trim(p_donor_email), ''));
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Correo electrónico inválido';
  END IF;

  v_method := nullif(trim(p_payment_method), '');
  IF v_method IS NULL OR v_method NOT IN ('transfer','card','cash') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  v_freq := coalesce(nullif(trim(p_frequency), ''), 'one_time');
  IF v_freq NOT IN ('one_time','monthly') THEN
    RAISE EXCEPTION 'Frecuencia de donación inválida';
  END IF;

  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.donation_campaigns c
    WHERE c.id = p_campaign_id AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Campaña no válida o inactiva';
  END IF;

  -- Referencia única de seguimiento: DON-YYYY-XXXXXX
  LOOP
    v_ref := 'DON-' || to_char(now(), 'YYYY') || '-'
             || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.donations WHERE tracking_ref = v_ref);
  END LOOP;

  INSERT INTO public.donations (
    tracking_ref, campaign_id, donor_name, donor_email, donor_phone,
    donor_tax_id, is_company, is_anonymous, amount, payment_method,
    bank_name, receipt_url, status, frequency
  ) VALUES (
    v_ref, p_campaign_id, v_name, v_email, nullif(trim(p_donor_phone), ''),
    nullif(trim(p_donor_tax_id), ''), coalesce(p_is_company, false),
    coalesce(p_is_anonymous, false), p_amount, v_method,
    nullif(trim(p_bank_name), ''), nullif(trim(p_receipt_url), ''), 'pending', v_freq
  ) RETURNING id INTO v_donation_id;

  RETURN jsonb_build_object(
    'success',       true,
    'donation_id',   v_donation_id,
    'tracking_ref',  v_ref,
    'amount',        p_amount,
    'currency',      'DOP',
    'frequency',     v_freq,
    'message',       'Donación registrada correctamente'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_referral(
  p_family_name text,
  p_email       text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_prereg_id   bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code  public.referral_codes%ROWTYPE;
  v_id    uuid;
  v_count int;
BEGIN
  IF p_family_name IS NULL OR trim(p_family_name) = '' THEN
    RAISE EXCEPTION 'Nombre de la familia referida es obligatorio';
  END IF;

  -- El padre debe tener un código (se crea si no existe)
  v_code := public.ensure_referral_code(auth.uid());

  -- No duplicar por email/celular si ya existe un referido igual
  IF p_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.referrals
    WHERE referrer_parent_id = auth.uid()
      AND referred_email = p_email
  ) THEN
    RAISE EXCEPTION 'Esa familia ya fue registrada por este medio';
  END IF;

  INSERT INTO public.referrals
    (referrer_parent_id, referred_family_name, referred_email, referred_phone, status, prereg_id)
  VALUES
    (auth.uid(), p_family_name, p_email, p_phone, 'invited', p_prereg_id)
  RETURNING id INTO v_id;

  UPDATE public.referral_codes
    SET total_invites_sent = total_invites_sent + 1
  WHERE id = v_code.id;

  SELECT count(*) INTO v_count FROM public.referrals
    WHERE referrer_parent_id = auth.uid() AND status = 'enrolled';

  RETURN jsonb_build_object('ok', true, 'referral_id', v_id, 'enrolled_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_donation(
  p_donation_id UUID,
  p_notes       TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: no autorizado';
  END IF;

  UPDATE public.donations
  SET status = 'rejected', notes = coalesce(nullif(trim(p_notes), ''), notes), approved_by = auth.uid()
  WHERE id = p_donation_id AND status IN ('pending','approved');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Donación no encontrada o ya procesada');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Donación rechazada');
END;
$$;

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

CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role          text;
  v_gen_day       int;
  v_due_day       int;
  v_now           date := current_date;
  v_target_month  text;
  v_due_date      date;
  v_last_day      date;
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_rank          int;
  v_discount      numeric;
  v_amount        numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos';
  END IF;

  SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_target_month := to_char(v_now, 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;
  v_last_day     := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date, COALESCE(s.discount_pct,0) AS discount_pct
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
      )
  LOOP
    -- Omitir solo a estudiantes que empiezan en un MES FUTURO (aún no inscritos)
    IF v_student.start_date IS NOT NULL AND v_student.start_date > v_last_day THEN
      CONTINUE;
    END IF;

    -- Descuento por hermanos (regla progresiva) + descuento personal
    v_rank := public.get_student_family_rank(v_student.id);
    IF v_rank >= 3 THEN     v_discount := 0.15;
    ELSIF v_rank = 2 THEN   v_discount := 0.10;
    ELSE                    v_discount := 0; END IF;
    v_discount := GREATEST(v_discount, LEAST(v_student.discount_pct, 100) / 100);
    v_amount := round((v_student.monthly_fee * (1 - v_discount))::numeric, 2);

    INSERT INTO public.payments
      (student_id, amount, original_amount, discount_pct, discount_amount,
       status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_amount, v_student.monthly_fee, round(v_discount * 100, 2),
            round((v_student.monthly_fee - v_amount)::numeric, 2),
            'pending', v_due_date, v_target_month, 'Mensualidad', now())
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

CREATE OR REPLACE FUNCTION public.save_boletin_notes(
  p_student_id      bigint,
  p_period_id       bigint,
  p_teacher_comment text DEFAULT NULL,
  p_fortalezas      text[] DEFAULT NULL,
  p_debilidades     text[] DEFAULT NULL,
  p_observaciones   text DEFAULT NULL,
  p_conducta        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_role         text;
  v_classroom_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_conducta IS NOT NULL AND p_conducta NOT IN ('Excelente','Muy buena','Buena','Regular') THEN
    RETURN jsonb_build_object('error', 'Conducta inválida');
  END IF;

  SELECT classroom_id INTO v_classroom_id
  FROM public.students WHERE id = p_student_id;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  INSERT INTO public.report_cards (
    student_id, classroom_id, period_id,
    teacher_comment, fortalezas, debilidades, directora_comment, conducta
  )
  VALUES (
    p_student_id, v_classroom_id, p_period_id,
    p_teacher_comment,
    COALESCE(p_fortalezas, '{}'),
    COALESCE(p_debilidades, '{}'),
    p_observaciones,
    p_conducta
  )
  ON CONFLICT (student_id, period_id) DO UPDATE SET
    teacher_comment  = EXCLUDED.teacher_comment,
    fortalezas       = EXCLUDED.fortalezas,
    debilidades      = EXCLUDED.debilidades,
    directora_comment = EXCLUDED.directora_comment,
    conducta         = EXCLUDED.conducta;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.search_students(query text)
RETURNS SETOF public.students LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.students
  WHERE search_vector @@ plainto_tsquery('simple', query)
     OR lower(name) LIKE lower('%'||query||'%')
     OR lower(COALESCE(matricula,'')) LIKE lower('%'||query||'%')
  ORDER BY ts_rank(search_vector, plainto_tsquery('simple', query)) DESC
  LIMIT 50;
$$;

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

CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text, p_data json DEFAULT NULL, p_link text DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
    VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now()) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  $$;

CREATE OR REPLACE FUNCTION public.set_business_suspended(p_suspended boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text;
BEGIN
  SELECT get_my_role() INTO _role;
  IF _role IS NULL OR _role NOT IN ('admin','directora') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin_permiso');
  END IF;

  IF p_suspended THEN
    UPDATE public.school_settings
      SET status = 'suspended',
          suspended_at = now(),
          suspension_reason = COALESCE(p_reason, 'Falta de pago de mensualidad')
      WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'status', 'suspended', 'suspended_at', now());
  ELSE
    UPDATE public.school_settings
      SET status = 'active',
          suspended_at = NULL,
          suspension_reason = NULL
      WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'status', 'active');
  END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

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
      school_year_requested, level_requested, schedule, entry_time, exit_time,
      estimated_entry_date, has_siblings, sibling_name,
      parent_1, parent_2, emergency_contact, authorized_people,
      medical, documents, consents, signature_data,
      contact_email, contact_phone, user_agent
    )
    VALUES (
      COALESCE(payload->>'student_name', 'Sin nombre'), payload->>'student_last_name',
      (payload->>'birth_date')::date, payload->>'gender', COALESCE(payload->>'nationality', 'Dominicana'),
      payload->>'school_year_requested', payload->>'level_requested', payload->>'schedule',
      (payload->>'entry_time')::time, (payload->>'exit_time')::time,
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

CREATE OR REPLACE FUNCTION public.sync_current_month_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_due_day int;
  v_now date := current_date;
  v_tm text; v_due date; v_last_day date;
  v_rank int; v_disc numeric; v_amount numeric;
BEGIN
  IF (NEW.is_active IS NOT FALSE) AND COALESCE(NEW.monthly_fee, 0) > 0 AND NEW.deleted_at IS NULL THEN
    SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
    FROM public.school_settings WHERE id = 1;

    -- Mes visible: el actual si ya pasó el día de generación, si no el próximo
    IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
      v_tm := to_char(v_now + interval '1 month', 'YYYY-MM');
      v_last_day := (date_trunc('month', v_now + interval '1 month') + interval '1 month - 1 day')::date;
    ELSE
      v_tm := to_char(v_now, 'YYYY-MM');
      v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;
    END IF;

    -- No cobrar a estudiantes que aún no inician (mes futuro)
    IF NEW.start_date IS NOT NULL AND NEW.start_date > v_last_day THEN
      RETURN NEW;
    END IF;

    v_due := (date_trunc('month', (v_tm || '-15')::date + interval '1 month') + (v_due_day - 1) * interval '1 day')::date;

    IF NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = NEW.id AND concept = 'Mensualidad' AND month_paid = v_tm AND deleted_at IS NULL
    ) THEN
      v_rank := public.get_student_family_rank(NEW.id);
      IF v_rank >= 3 THEN v_disc := 0.15;
      ELSIF v_rank = 2 THEN v_disc := 0.10;
      ELSE v_disc := 0; END IF;
      v_disc := GREATEST(v_disc, LEAST(COALESCE(NEW.discount_pct, 0), 100) / 100);
      v_amount := round((NEW.monthly_fee * (1 - v_disc))::numeric, 2);

      INSERT INTO public.payments
        (student_id, amount, original_amount, discount_pct, discount_amount,
         status, due_date, month_paid, concept, created_at)
      VALUES (NEW.id, v_amount, NEW.monthly_fee, round(v_disc * 100, 2),
              round((NEW.monthly_fee - v_amount)::numeric, 2),
              'pending', v_due, v_tm, 'Mensualidad', now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.update_payment_amount(p_payment_id bigint, p_amount numeric, p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role    text;
  v_before  numeric;
  v_month   text;
  v_concept text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ajustar montos';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999 THEN
    RAISE EXCEPTION 'Monto inválido (0 - 999999)';
  END IF;

  SELECT amount, month_paid, concept INTO v_before, v_month, v_concept
  FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;

  IF v_before = p_amount THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'amount', p_amount);
  END IF;

  UPDATE public.payments
  SET amount    = p_amount,
      notes     = COALESCE(NULLIF(notes,'') || ' | ', '') ||
                  'Monto ajustado: ' || v_before::numeric::text || ' -> ' || p_amount::numeric::text ||
                  CASE WHEN coalesce(p_reason,'') <> '' THEN ' (' || p_reason || ')' ELSE '' END,
      updated_at = now()
  WHERE id = p_payment_id;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), 'payment.amount_updated',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'old_amount', v_before,
      'new_amount', p_amount,
      'month_paid', v_month,
      'concept',    v_concept,
      'reason',     p_reason
    ), now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'changed', true, 'old_amount', v_before, 'amount', p_amount);
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

CREATE OR REPLACE FUNCTION public.update_staff_permits_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.update_subject(
  p_subject_id   bigint,
  p_name         text,
  p_description  text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'El nombre del área es requerido');
  END IF;

  UPDATE public.subjects
  SET name        = btrim(p_name),
      description = NULLIF(btrim(COALESCE(p_description, '')), '')
  WHERE id = p_subject_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Área no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.user_is_participant(p_conversation_id bigint, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id
  );
$$;

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

CREATE OR REPLACE FUNCTION store_deduct_stock_on_confirm()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.status = 'confirmed' AND (OLD.status IS DISTINCT FROM 'confirmed') THEN
      INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id, order_id, size_label)
      SELECT
        i.product_id,
        'exit',
        -i.quantity,
        'venta',
        NEW.parent_id,
        NEW.id,
        i.size_label
      FROM store_order_items i
      WHERE i.order_id = NEW.id;

      UPDATE store_products sp
      SET stock = GREATEST(0, sp.stock - i.quantity)
      FROM store_order_items i
      WHERE i.order_id = NEW.id
        AND sp.id = i.product_id;

      -- Descontar también la talla específica
      UPDATE store_product_sizes s
      SET stock = GREATEST(0, s.stock - i.quantity)
      FROM store_order_items i
      WHERE i.order_id = NEW.id
        AND s.product_id = i.product_id
        AND i.size_label IS NOT NULL
        AND s.size_label = i.size_label;
    END IF;
    RETURN NEW;
  END;
  $$;

CREATE OR REPLACE FUNCTION store_manual_movement(
    p_product_id UUID,
    p_type       TEXT,
    p_quantity   INT,
    p_reason     TEXT DEFAULT NULL
  )
  RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v_actor UUID := auth.uid();
  BEGIN
    IF p_type NOT IN ('entry','exit','adjustment') THEN
      RAISE EXCEPTION 'Tipo inválido: %', p_type;
    END IF;

    INSERT INTO store_inventory(product_id, type, quantity, reason, actor_id)
    VALUES (p_product_id, p_type, p_quantity, p_reason, v_actor);

    -- Actualizar stock
    UPDATE store_products
    SET stock = GREATEST(0, stock + p_quantity)
    WHERE id = p_product_id;
  END;
  $$;

CREATE OR REPLACE FUNCTION store_manual_movement_v2(
    p_product_id UUID,
    p_type       TEXT,
    p_quantity   INT,
    p_reason     TEXT DEFAULT NULL,
    p_size_label TEXT DEFAULT NULL
  )
  RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_actor     UUID := auth.uid();
    v_signed    INT;
    v_has_sizes BOOLEAN;
    v_available INT;
  BEGIN
    IF p_type NOT IN ('entry','exit','adjustment') THEN
      RAISE EXCEPTION 'Tipo inválido: %', p_type;
    END IF;

    SELECT has_sizes INTO v_has_sizes FROM store_products WHERE id = p_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

    IF p_type = 'exit' THEN
      v_signed := -ABS(p_quantity);
    ELSIF p_type = 'entry' THEN
      v_signed := ABS(p_quantity);
    ELSE
      v_signed := p_quantity;  -- ajuste: delta con signo
    END IF;

    -- Validación dura: salida sin talla en producto con tallas
    IF p_type = 'exit' AND v_has_sizes AND COALESCE(p_size_label,'') = '' THEN
      RAISE EXCEPTION 'FALTA_TALLA: este producto se gestiona por tallas, selecciona una talla';
    END IF;

    IF COALESCE(p_size_label,'') <> '' THEN
      SELECT stock INTO v_available
      FROM store_product_sizes
      WHERE product_id = p_product_id AND size_label = p_size_label;

      IF v_available IS NULL THEN
        RAISE EXCEPTION 'La talla "%" no existe para este producto', p_size_label;
      END IF;
      IF v_available + v_signed < 0 THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: solo hay % unidades en talla %', v_available, p_size_label;
      END IF;

      INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id, size_label)
      VALUES (p_product_id, p_type, v_signed, p_reason, v_actor, p_size_label);

      UPDATE store_product_sizes
      SET stock = stock + v_signed
      WHERE product_id = p_product_id AND size_label = p_size_label;

      -- El stock general del producto siempre refleja la suma de sus tallas
      UPDATE store_products sp
      SET stock = COALESCE((SELECT SUM(s.stock) FROM store_product_sizes s WHERE s.product_id = sp.id), 0)
      WHERE id = p_product_id;
    ELSE
      IF v_available IS NULL AND p_type = 'exit' THEN
        SELECT stock INTO v_available FROM store_products WHERE id = p_product_id;
        IF v_available + v_signed < 0 THEN
          RAISE EXCEPTION 'STOCK_INSUFICIENTE: solo hay % unidades disponibles', v_available;
        END IF;
      END IF;

      INSERT INTO store_inventory (product_id, type, quantity, reason, actor_id)
      VALUES (p_product_id, p_type, v_signed, p_reason, v_actor);

      UPDATE store_products
      SET stock = GREATEST(0, stock + v_signed)
      WHERE id = p_product_id;
    END IF;
  END;
  $$;

CREATE OR REPLACE FUNCTION store_recalculate_order_total()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
  DECLARE v_order_id UUID;
  BEGIN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);
    UPDATE store_orders
    SET total = (
      SELECT COALESCE(SUM(subtotal), 0)
      FROM store_order_items
      WHERE order_id = v_order_id
    )
    WHERE id = v_order_id;
    RETURN NULL;
  END;
  $$;

CREATE OR REPLACE FUNCTION store_set_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$;


-- ---- VISTAS --------------------------------------------------------------
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

DROP VIEW IF EXISTS public.v_active_tasks;

CREATE VIEW public.v_active_tasks AS
SELECT t.*, p.name AS period_name, p.status AS period_status
FROM public.tasks t
LEFT JOIN public.periods p ON p.id = t.period_id
WHERE p.is_active = true
  OR (t.period_id IS NULL AND EXISTS (
    SELECT 1 FROM public.periods ap WHERE ap.classroom_id = t.classroom_id AND ap.is_active = true
      AND t.created_at BETWEEN ap.start_date AND ap.end_date + INTERVAL '1 day'));

CREATE OR REPLACE VIEW store_inventory_view AS
  SELECT
    i.id,
    i.created_at,
    i.type,
    i.quantity,
    i.reason,
    p.name    AS product_name,
    p.images[1] AS product_image,
    c.name    AS category_name,
    pr.name   AS actor_name,
    i.order_id
  FROM store_inventory i
  LEFT JOIN store_products    p  ON p.id = i.product_id
  LEFT JOIN store_categories  c  ON c.id = p.category_id
  LEFT JOIN profiles          pr ON pr.id = i.actor_id
  ORDER BY i.created_at DESC;

CREATE OR REPLACE VIEW public.v_backup_status AS
SELECT
  COALESCE(MAX(created_at), NULL) AS last_backup_at,
  COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS backups_last_24h,
  COUNT(*) AS total_backups
FROM public.system_events
WHERE type = 'backup.completed';


-- ---- TRIGGERS ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_comment_change ON public.comments;

CREATE TRIGGER on_comment_change AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comments_count();

DROP TRIGGER IF EXISTS on_like_change ON public.likes;

CREATE TRIGGER on_like_change AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();

DROP TRIGGER IF EXISTS on_new_post_populate_teacher ON public.posts;

CREATE TRIGGER on_new_post_populate_teacher BEFORE INSERT ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_post_teacher_info();

DROP TRIGGER IF EXISTS on_student_upsert_chat ON public.students;

CREATE TRIGGER on_student_upsert_chat AFTER INSERT OR UPDATE OF classroom_id, parent_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.handle_student_chat_creation();

DROP TRIGGER IF EXISTS on_new_payment_charge ON public.payments;

CREATE TRIGGER on_new_payment_charge AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_parent_on_new_charge();

DROP TRIGGER IF EXISTS tr_update_staff_permits_timestamp ON public.staff_permits;

CREATE TRIGGER tr_update_staff_permits_timestamp BEFORE UPDATE ON public.staff_permits
  FOR EACH ROW EXECUTE FUNCTION public.update_staff_permits_timestamp();

DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;

CREATE TRIGGER trg_audit_payment AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment();

DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;

CREATE TRIGGER trg_protect_paid_records BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

DROP TRIGGER IF EXISTS trg_on_evidence_uploaded ON public.payments;

CREATE TRIGGER trg_on_evidence_uploaded BEFORE UPDATE OF proof_url, evidence_url ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_payment_evidence_uploaded();

DROP TRIGGER IF EXISTS audit_role_change ON public.profiles;

CREATE TRIGGER audit_role_change AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_role_change();

DROP TRIGGER IF EXISTS trg_validate_role_change ON public.profiles;

CREATE TRIGGER trg_validate_role_change BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_role_change();

DROP TRIGGER IF EXISTS trg_validate_avatar_profiles ON public.profiles;

CREATE TRIGGER trg_validate_avatar_profiles BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

DROP TRIGGER IF EXISTS trg_validate_avatar_students ON public.students;

CREATE TRIGGER trg_validate_avatar_students BEFORE INSERT OR UPDATE OF avatar_url ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;

CREATE TRIGGER set_reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_report_actions_updated_at ON public.report_actions;

CREATE TRIGGER set_report_actions_updated_at BEFORE UPDATE ON public.report_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_report_changes ON public.reports;

CREATE TRIGGER audit_report_changes AFTER INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_report_change();

DROP TRIGGER IF EXISTS trg_reenrollment_payment ON public.payments;

CREATE TRIGGER trg_reenrollment_payment
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_reenrollment_on_payment_approved();

DROP TRIGGER IF EXISTS trg_reenrollment_year ON public.school_years;

CREATE TRIGGER trg_reenrollment_year
  AFTER INSERT OR UPDATE OF status ON public.school_years
  FOR EACH ROW EXECUTE FUNCTION public.fn_reenrollment_on_year_activate();

DROP TRIGGER IF EXISTS trg_store_products_updated ON store_products;

CREATE TRIGGER trg_store_products_updated
    BEFORE UPDATE ON store_products
    FOR EACH ROW EXECUTE FUNCTION store_set_updated_at();

DROP TRIGGER IF EXISTS trg_store_orders_updated ON store_orders;

CREATE TRIGGER trg_store_orders_updated
    BEFORE UPDATE ON store_orders
    FOR EACH ROW EXECUTE FUNCTION store_set_updated_at();

DROP TRIGGER IF EXISTS trg_store_deduct_stock ON store_orders;

CREATE TRIGGER trg_store_deduct_stock
    AFTER UPDATE ON store_orders
    FOR EACH ROW EXECUTE FUNCTION store_deduct_stock_on_confirm();

DROP TRIGGER IF EXISTS trg_store_order_total ON store_order_items;

CREATE TRIGGER trg_store_order_total
    AFTER INSERT OR UPDATE OR DELETE ON store_order_items
    FOR EACH ROW EXECUTE FUNCTION store_recalculate_order_total();

DROP TRIGGER IF EXISTS trg_sync_month_payment ON public.students;

CREATE TRIGGER trg_sync_month_payment
AFTER INSERT OR UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.sync_current_month_payment();

DROP TRIGGER IF EXISTS trg_kiosk_notify ON public.door_punches;

CREATE TRIGGER trg_kiosk_notify
  AFTER INSERT OR UPDATE OF punch_type ON public.door_punches
  FOR EACH ROW EXECUTE FUNCTION public.trigger_kiosk_notify();

DROP TRIGGER IF EXISTS trg_school_settings_status ON public.school_settings;

CREATE TRIGGER trg_school_settings_status
  AFTER UPDATE OF status ON public.school_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_business_status_change();


-- ---- STORAGE BUCKETS -----------------------------------------------------
-- classroom_media admite video y queda en 25 MB (propuesta.md seccion 18).
-- karpus-uploads NO admite video: el muro debe subir a classroom_media.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars','avatars',true,5242880,ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom_media','classroom_media',true,52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=52428800;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('karpus-uploads','karpus-uploads',true,5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880;


-- ---- POLITICAS DE STORAGE ------------------------------------------------
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

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "classroom_media_public_read" ON storage.objects;
CREATE POLICY "classroom_media_public_read" ON storage.objects FOR SELECT USING (bucket_id='classroom_media');

DROP POLICY IF EXISTS "classroom_media_auth_insert" ON storage.objects;
CREATE POLICY "classroom_media_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='classroom_media' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "classroom_media_auth_update" ON storage.objects;
CREATE POLICY "classroom_media_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='classroom_media' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_public_read" ON storage.objects;
CREATE POLICY "karpus_uploads_public_read" ON storage.objects FOR SELECT USING (bucket_id='karpus-uploads');

DROP POLICY IF EXISTS "karpus_uploads_auth_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='karpus-uploads' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_auth_update" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_auth_delete" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');


-- ---- COMENTARIOS ---------------------------------------------------------
comment on column public.school_settings.feature_flags is
    'Visibilidad de módulos: {modules:{[key]:{enabled,roles}}, overrides:{[uuid]:{[key]:allow|deny}}}';

COMMENT ON FUNCTION public.is_family_member(bigint) IS
  'Devuelve true si el padre autenticado pertenece a la familia del estudiante (parent_id, email/cédula de tutor o sibling_id).';

COMMENT ON COLUMN public.donations.frequency IS
  'Frecuencia: one_time = donación única, monthly = aporte mensual recurrente';

COMMENT ON COLUMN public.school_settings.status IS 'Estado del servicio: active (normal) o suspended (bloqueado).';

COMMENT ON COLUMN public.school_settings.suspended_at IS 'Timestamp de la última suspensión. NULL si está activo.';

COMMENT ON COLUMN public.school_settings.suspension_reason IS 'Motivo interno de la suspensión. NUNCA mostrar al cliente.';

COMMENT ON COLUMN posts.thumbnail_urls IS 'Array de URLs de thumbnails generados al subir video (vista previa estilo YouTube)';

COMMENT ON COLUMN posts.duration IS 'Duración del video en segundos (null para publicaciones sin video)';


-- ---- GRANTS --------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_period_open(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text, jsonb, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_email_under_attack(text) TO authenticated;

GRANT SELECT ON public.v_payments_with_mora TO authenticated;

GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

GRANT EXECUTE ON FUNCTION public.preview_payment_cycle() TO authenticated;

GRANT EXECUTE ON FUNCTION public.check_payment_cycle_health() TO authenticated;

GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.delete_payment(bigint, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.waive_payment_mora(bigint, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.reset_payment_to_pending(bigint, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

GRANT EXECUTE ON FUNCTION public.find_or_create_private_conversation(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_legacy_periods_for_sync() TO authenticated;

GRANT EXECUTE ON FUNCTION public.assign_student_to_classroom(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.assign_students_bulk(bigint[], bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_student_punch(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.process_student_punch(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.generate_annual_payments(int) TO authenticated;

GRANT EXECUTE ON FUNCTION public.pay_full_year(bigint, int, numeric) TO authenticated;

GRANT EXECUTE ON FUNCTION public.mark_overdue_payments() TO authenticated;

GRANT EXECUTE ON FUNCTION public.financial_summary_month(int, int) TO authenticated;

GRANT EXECUTE ON FUNCTION public.attendance_last_7_days() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_periods_for_year(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.advance_school_year_state() TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_enroll_student(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_period_stats(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.close_school_year(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.promote_students(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_school_year(bigint, text, date, date, date, date, date, date, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.delete_academic_periods_by_year(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_first_academic_period(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_period_id(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.generate_student_charges(bigint,text,numeric,numeric,numeric,numeric,int,int,text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_classrooms_capacity() TO authenticated;

GRANT EXECUTE ON FUNCTION public.review_preregistration(bigint,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_preinscripcion(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_preinscripcion(jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_preinscripcion_documents(bigint, jsonb) TO anon, authenticated;

GRANT SELECT ON public.payment_concepts TO anon, authenticated;

GRANT INSERT ON public.student_preregistrations TO anon, authenticated;

GRANT SELECT, UPDATE ON public.student_preregistrations TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_charges TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.student_preregistrations_id_seq TO anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.student_charges_id_seq TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.payment_concepts_id_seq TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_current_period() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_active_period(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.activate_period(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.close_period(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_active_school_year() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_school_year_status() TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_school_year(text,date,date,date,date,date,date,text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_academic_period(bigint,text,date,date,integer,text,boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.activate_academic_period(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_tasks_for_period(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_posts_for_period(bigint, bigint, int) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_period_config(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_grades_v2(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_subject_averages(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_history(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_classroom_schedule(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.log_timeline_event(bigint,text,uuid,bigint[],time,smallint,jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.search_students(text) TO authenticated;

GRANT SELECT ON public.v_brute_force_attempts TO authenticated;

GRANT SELECT ON public.v_active_tasks TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts               TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments            TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes               TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance          TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_logs          TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.door_punches        TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public              TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_posts_for_parent(bigint) TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO service_role;

GRANT EXECUTE ON FUNCTION public.generate_reenrollment_requests(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.review_reenrollment(bigint, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_period_config(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_boletin(bigint, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.save_boletin_notes(bigint, bigint, text, text[], text[], text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_subject(bigint, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_grade_periods() TO authenticated;

GRANT EXECUTE ON FUNCTION public.insert_subject(text, text, text, bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_classrooms_capacity() TO anon;

GRANT EXECUTE ON FUNCTION public.increment_post_views(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.increment_post_views(bigint) TO anon;

GRANT EXECUTE ON FUNCTION public.increment_post_views(bigint) TO service_role;

GRANT EXECUTE ON FUNCTION public.increment_referral_count(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.ensure_referral_code(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.register_referral(text,text,text,bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.apply_referral_reward(uuid,bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_embajador_dashboard() TO authenticated;

REVOKE ALL ON public.referral_codes, public.referrals, public.referral_rewards FROM PUBLIC;

GRANT SELECT ON public.referral_codes TO authenticated;

GRANT SELECT ON public.referrals TO authenticated;

GRANT SELECT ON public.referral_rewards TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_payment_amount(bigint, numeric, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_family_rank(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_family_member(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.apply_payment_discount(bigint, numeric, text, numeric) TO authenticated;

GRANT EXECUTE ON FUNCTION public.run_daily_backup() TO authenticated;

REVOKE ALL ON FUNCTION public.purge_old_audit_logs(int) FROM authenticated, anon;

GRANT EXECUTE ON FUNCTION public.get_login_stats() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_login_series() TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_business_suspended() TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_business_suspension_info() TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_business_suspended(boolean, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO authenticated;

GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO anon;
