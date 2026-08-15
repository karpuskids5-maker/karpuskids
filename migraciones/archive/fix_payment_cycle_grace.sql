-- ============================================================
-- KARPUS KIDS — Ciclo de Pagos con Regla de Gracia
-- Ejecutar en Supabase SQL Editor
-- 
-- Regla de gracia para estudiantes nuevos:
--   - Inscrito ANTES del día 25: primer cobro = mes siguiente
--   - Inscrito el día 25 o DESPUÉS: primer cobro = 2 meses después
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now           date := current_date;
  v_gen_day       int;
  v_due_day       int;
  v_target_month  text;   -- YYYY-MM del mes a cobrar
  v_due_date      date;   -- fecha de vencimiento
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_start_day     int;
  v_first_billing text;   -- YYYY-MM del primer mes elegible
  v_first_m       int;
  v_first_y       int;
BEGIN
  -- Obtener configuración
  SELECT
    COALESCE(generation_day, 25),
    COALESCE(due_day, 5)
  INTO v_gen_day, v_due_day
  FROM public.school_settings
  WHERE id = 1
  LIMIT 1;

  -- Si no hay configuración, usar defaults
  IF v_gen_day IS NULL THEN v_gen_day := 25; END IF;
  IF v_due_day IS NULL THEN v_due_day := 5; END IF;

  -- Calcular mes objetivo (el mes siguiente al actual)
  v_target_month := to_char(v_now + interval '1 month', 'YYYY-MM');

  -- Calcular fecha de vencimiento (día v_due_day del mes siguiente al objetivo)
  v_due_date := (date_trunc('month', v_now + interval '2 months') + (v_due_day - 1) * interval '1 day')::date;

  -- Generar cobros para estudiantes elegibles
  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.start_date
    FROM public.students s
    WHERE s.is_active = true
      AND s.monthly_fee > 0
      AND s.deleted_at IS NULL
      -- Excluir estudiantes que ya tienen cobro para este mes
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id
          AND p.month_paid = v_target_month
      )
  LOOP
    -- Aplicar regla de gracia
    IF v_student.start_date IS NOT NULL THEN
      v_start_day := EXTRACT(DAY FROM v_student.start_date)::int;

      -- Calcular primer mes de cobro según regla de gracia
      IF v_start_day < v_gen_day THEN
        -- Inscrito antes del día de generación: cobrar desde el mes siguiente
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m = 12 THEN
          v_first_m := 1; v_first_y := v_first_y + 1;
        ELSE
          v_first_m := v_first_m + 1;
        END IF;
      ELSE
        -- Inscrito el día de generación o después: cobrar desde 2 meses después
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int + 2;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m > 12 THEN
          v_first_m := v_first_m - 12; v_first_y := v_first_y + 1;
        END IF;
      END IF;

      v_first_billing := v_first_y || '-' || LPAD(v_first_m::text, 2, '0');

      -- Solo cobrar si el mes objetivo >= primer mes elegible
      IF v_target_month < v_first_billing THEN
        CONTINUE; -- Estudiante en período de gracia, saltar
      END IF;
    END IF;

    -- Insertar cobro
    INSERT INTO public.payments (
      student_id, amount, status, due_date, month_paid, concept, created_at
    ) VALUES (
      v_student.id, v_student.monthly_fee, 'pending',
      v_due_date, v_target_month, 'Mensualidad', now()
    )
    ON CONFLICT DO NOTHING;

    v_generated := v_generated + 1;
  END LOOP;

  -- Marcar como vencidos los pagos pendientes con due_date pasado
  UPDATE public.payments
  SET status = 'overdue', updated_at = now()
  WHERE status = 'pending'
    AND due_date < v_now;

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'generated', v_generated,
    'expired',   v_expired,
    'month',     v_target_month,
    'due_date',  v_due_date::text,
    'gen_day',   v_gen_day
  );
END;
$$;

-- Asegurar que la columna start_date existe en students
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS start_date date;

-- Índice para mejorar el rendimiento del ciclo
CREATE INDEX IF NOT EXISTS idx_students_active_fee
  ON public.students (is_active, monthly_fee)
  WHERE is_active = true AND monthly_fee > 0;

CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON public.payments (student_id, month_paid);
