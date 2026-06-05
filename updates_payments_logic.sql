-- 1. Función para calcular mora dinámicamente
CREATE OR REPLACE FUNCTION public.calculate_mora(
  p_amount numeric,
  p_due_date date,
  p_status text
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_mora numeric := 0;
  v_days_late int;
  v_months_late int;
  v_mora_rate numeric := 0.05; -- 5% mensual
BEGIN
  IF p_status = 'paid' OR p_status = 'rejected' OR p_due_date IS NULL OR p_due_date >= CURRENT_DATE THEN
    RETURN 0;
  END IF;

  v_days_late := CURRENT_DATE - p_due_date;
  IF v_days_late > 0 THEN
    v_months_late := ceil(v_days_late::numeric / 30.0);
    v_mora := p_amount * v_mora_rate * v_months_late;
  END IF;

  RETURN v_mora;
END;
$$;

-- 2. Actualizar la vista de pagos con mora para incluir el cálculo centralizado
DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT 
  p.*,
  public.calculate_mora(p.amount, p.due_date, p.status) as calculated_mora,
  (p.amount + public.calculate_mora(p.amount, p.due_date, p.status)) as total_due,
  s.name as student_name,
  s.p1_name,
  s.p2_name,
  s.p1_email,
  s.p2_email,
  s.p1_phone,
  s.p2_phone,
  c.name as classroom_name
FROM public.payments p
LEFT JOIN public.students s ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
WHERE p.deleted_at IS NULL;

-- 3. Actualizar el ciclo de pagos con la regla de gracia centralizada
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day      int;
  v_due_day      int;
  v_today        int := extract(day from current_date)::int;
  v_cur_month    int := extract(month from current_date)::int;
  v_cur_year     int := extract(year  from current_date)::int;
  v_target_month int;
  v_target_year  int;
  v_due_month    int;
  v_due_year     int;
  v_gen_count    int := 0;
  v_expire_count int := 0;
  v_due_date     date;
  v_month_key    text;
  v_first_billing_date date;
BEGIN
  -- Obtener configuración
  SELECT generation_day, due_day INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  IF v_gen_day IS NULL THEN
    RETURN jsonb_build_object('error', 'school_settings no encontrado');
  END IF;

  -- Solo ejecutar si hoy es >= dia de generacion
  IF v_today < v_gen_day THEN
    -- Aún así marcamos vencidos los que pasaron su fecha
    UPDATE public.payments
    SET status = 'overdue'
    WHERE status = 'pending' AND due_date < CURRENT_DATE AND deleted_at IS NULL;
    GET DIAGNOSTICS v_expire_count = ROW_COUNT;
    
    RETURN jsonb_build_object('generated', 0, 'expired', v_expire_count, 'message', 'Aun no es dia de generacion');
  END IF;

  -- El cobro que se genera hoy es para el MES SIGUIENTE
  v_target_month := v_cur_month + 1;
  v_target_year  := v_cur_year;
  IF v_target_month > 12 THEN 
    v_target_month := 1; 
    v_target_year := v_target_year + 1; 
  END IF;
  
  v_month_key := v_target_year || '-' || LPAD(v_target_month::text, 2, '0');

  -- La fecha de vencimiento es el dia v_due_day del mes SIGUIENTE al cobro (o el mismo mes del cobro?)
  -- Segun JS: monthKey es el mes del cobro. due_date es el dia due_day del mes SIGUIENTE al cobro.
  v_due_month := v_target_month + 1;
  v_due_year  := v_target_year;
  IF v_due_month > 12 THEN 
    v_due_month := 1; 
    v_due_year := v_due_year + 1; 
  END IF;
  v_due_date := make_date(v_due_year, v_due_month, v_due_day);

  -- 1. Generar Mensualidad con REGLA DE GRACIA
  -- Si el estudiante entró antes del 25, se le cobra el mes siguiente.
  -- Si entró el 25 o después, se le cobra el mes subsiguiente.
  INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept)
  SELECT s.id, s.monthly_fee, 'pending', v_due_date, v_month_key, 'Mensualidad'
  FROM public.students s
  WHERE s.is_active = true AND s.monthly_fee > 0
    AND (
      s.start_date IS NULL 
      OR (
        CASE 
          WHEN extract(day from s.start_date) < v_gen_day THEN 
            -- Primer cobro: mes siguiente al inicio
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '1 month'
          ELSE 
            -- Primer cobro: 2 meses despues del inicio
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '2 months'
        END <= make_date(v_target_year, v_target_month, 1)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.student_id = s.id AND p.month_paid = v_month_key AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
    );
  GET DIAGNOSTICS v_gen_count = ROW_COUNT;

  -- 2. Generar Día Prolongado (si aplica)
  INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept)
  SELECT s.id, s.prolongado_fee, 'pending', v_due_date, v_month_key, 'Día Prolongado'
  FROM public.students s
  WHERE s.is_active = true AND s.prolongado_fee > 0
    AND (
      s.start_date IS NULL 
      OR (
        CASE 
          WHEN extract(day from s.start_date) < v_gen_day THEN 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '1 month'
          ELSE 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '2 months'
        END <= make_date(v_target_year, v_target_month, 1)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.student_id = s.id AND p.month_paid = v_month_key AND p.concept = 'Día Prolongado' AND p.deleted_at IS NULL
    );
  
  DECLARE
    v_prolong_count int;
  BEGIN
    GET DIAGNOSTICS v_prolong_count = ROW_COUNT;
    v_gen_count := v_gen_count + v_prolong_count;
  END;

  -- 3. Marcar como vencidos
  UPDATE public.payments
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < CURRENT_DATE AND deleted_at IS NULL;
  GET DIAGNOSTICS v_expire_count = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_gen_count, 'expired', v_expire_count, 'month_key', v_month_key);
END;
$$;

-- 4. Función para previsualizar el ciclo de pagos
CREATE OR REPLACE FUNCTION public.preview_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day      int;
  v_due_day      int;
  v_today        int := extract(day from current_date)::int;
  v_cur_month    int := extract(month from current_date)::int;
  v_cur_year     int := extract(year  from current_date)::int;
  v_target_month int;
  v_target_year  int;
  v_month_key    text;
  v_gen_count    int := 0;
  v_total_amount numeric := 0;
  v_grace_count  int := 0;
  v_existing_count int := 0;
BEGIN
  SELECT generation_day, due_day INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_target_month := v_cur_month + 1;
  v_target_year  := v_cur_year;
  IF v_target_month > 12 THEN v_target_month := 1; v_target_year := v_target_year + 1; END IF;
  v_month_key := v_target_year || '-' || LPAD(v_target_month::text, 2, '0');

  -- Estudiantes que entrarían en el ciclo
  SELECT count(*), coalesce(sum(monthly_fee + prolongado_fee), 0) INTO v_gen_count, v_total_amount
  FROM public.students s
  WHERE s.is_active = true 
    AND (s.monthly_fee > 0 OR s.prolongado_fee > 0)
    AND (
      s.start_date IS NULL 
      OR (
        CASE 
          WHEN extract(day from s.start_date) < v_gen_day THEN 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '1 month'
          ELSE 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '2 months'
        END <= make_date(v_target_year, v_target_month, 1)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.student_id = s.id AND p.month_paid = v_month_key AND p.deleted_at IS NULL
    );

  -- Estudiantes en periodo de gracia (activos que NO entran en este ciclo por su fecha de inicio)
  SELECT count(*) INTO v_grace_count
  FROM public.students s
  WHERE s.is_active = true 
    AND (s.monthly_fee > 0 OR s.prolongado_fee > 0)
    AND NOT (
      s.start_date IS NULL 
      OR (
        CASE 
          WHEN extract(day from s.start_date) < v_gen_day THEN 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '1 month'
          ELSE 
            make_date(extract(year from s.start_date)::int, extract(month from s.start_date)::int, 1) + interval '2 months'
        END <= make_date(v_target_year, v_target_month, 1)
      )
    );

  -- Estudiantes que ya tienen el cobro generado
  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments
  WHERE month_paid = v_month_key AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'target_month', v_month_key,
    'target_month_label', to_char(make_date(v_target_year, v_target_month, 1), 'TMMonth YYYY'),
    'count', v_gen_count,
    'total_amount', v_total_amount,
    'grace_count', v_grace_count,
    'existing_count', v_existing_count
  );
END;
$$;
