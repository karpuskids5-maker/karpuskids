-- ============================================================
-- FIX COMPLETO: Sistema de cobros Karpus Kids 2026
-- Regla: cobro generado el día 25 del mes actual
--        vence el día 5 del mes SIGUIENTE
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. Corregir due_dates incorrectos para TODO el año 2026 ──────────────────
-- Cada mes tiene su due_date correcto = día 5 del mes siguiente

UPDATE public.payments SET due_date = '2026-02-05', status = 'pending'
WHERE month_paid = '2026-01' AND due_date != '2026-02-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-03-05', status = 'pending'
WHERE month_paid = '2026-02' AND due_date != '2026-03-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-04-05', status = 'pending'
WHERE month_paid = '2026-03' AND due_date != '2026-04-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-05-05', status = 'pending'
WHERE month_paid = '2026-04' AND due_date != '2026-05-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-06-05', status = 'pending'
WHERE month_paid = '2026-05' AND due_date != '2026-06-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-07-05', status = 'pending'
WHERE month_paid = '2026-06' AND due_date != '2026-07-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-08-05', status = 'pending'
WHERE month_paid = '2026-07' AND due_date != '2026-08-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-09-05', status = 'pending'
WHERE month_paid = '2026-08' AND due_date != '2026-09-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-10-05', status = 'pending'
WHERE month_paid = '2026-09' AND due_date != '2026-10-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-11-05', status = 'pending'
WHERE month_paid = '2026-10' AND due_date != '2026-11-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2026-12-05', status = 'pending'
WHERE month_paid = '2026-11' AND due_date != '2026-12-05' AND status IN ('pending','overdue');

UPDATE public.payments SET due_date = '2027-01-05', status = 'pending'
WHERE month_paid = '2026-12' AND due_date != '2027-01-05' AND status IN ('pending','overdue');

-- ── 2. Re-marcar como overdue solo los que REALMENTE vencieron ───────────────
-- (due_date < hoy Y status = pending)
UPDATE public.payments
SET status = 'overdue'
WHERE status = 'pending'
  AND due_date < current_date;

-- ── 3. Actualizar función run_payment_cycle con lógica correcta ──────────────
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day      int;
  v_due_day      int;
  v_today        int := EXTRACT(day FROM current_date)::int;
  v_cur_month    int := EXTRACT(month FROM current_date)::int;
  v_cur_year     int := EXTRACT(year  FROM current_date)::int;
  v_next_month   int;
  v_next_year    int;
  v_gen_count    int := 0;
  v_expire_count int := 0;
  v_due_date     date;
  v_month_key    text;
BEGIN
  SELECT generation_day, due_day INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  IF v_gen_day IS NULL THEN
    RETURN jsonb_build_object('error', 'school_settings no encontrado');
  END IF;

  -- Regla: month_paid = mes ACTUAL, due_date = día v_due_day del mes SIGUIENTE
  -- Ejemplo: 25 de Abril → genera cobro "2026-04" con vencimiento 5 de Mayo
  IF v_today >= v_gen_day THEN
    v_month_key  := to_char(current_date, 'YYYY-MM');
    v_next_month := v_cur_month + 1;
    v_next_year  := v_cur_year;
    IF v_next_month > 12 THEN v_next_month := 1; v_next_year := v_next_year + 1; END IF;
    v_due_date := make_date(v_next_year, v_next_month, v_due_day);

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept)
    SELECT s.id, s.monthly_fee, 'pending', v_due_date, v_month_key, 'Mensualidad'
    FROM public.students s
    WHERE s.is_active = true
      AND s.monthly_fee > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_month_key
      );
    GET DIAGNOSTICS v_gen_count = ROW_COUNT;
  END IF;

  -- Marcar vencidos: pending cuyo due_date ya pasó
  UPDATE public.payments
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < current_date;
  GET DIAGNOSTICS v_expire_count = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_gen_count, 'expired', v_expire_count);
END;
$$;

-- ── 4. Verificar resultado ───────────────────────────────────────────────────
SELECT month_paid, due_date, status, COUNT(*) as total
FROM public.payments
WHERE month_paid LIKE '2026-%'
GROUP BY month_paid, due_date, status
ORDER BY month_paid, status;
