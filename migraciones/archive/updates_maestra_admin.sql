-- 1. Agregar estado a reportes diarios
ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS status text DEFAULT 'published' CHECK (status IN ('draft', 'published'));

-- 2. Índices de performance para pagos
CREATE INDEX IF NOT EXISTS idx_payments_month_status ON public.payments(month_paid, status) WHERE deleted_at IS NULL;

-- 3. Healthcheck para ciclo de pagos
-- Verifica si el ciclo de pagos se ejecutó el día 25 o después para el mes actual
CREATE OR REPLACE FUNCTION public.check_payment_cycle_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day      int;
  v_today        int := extract(day from current_date)::int;
  v_cur_month    int := extract(month from current_date)::int;
  v_cur_year     int := extract(year  from current_date)::int;
  v_month_key    text;
  v_has_payments boolean;
BEGIN
  SELECT generation_day INTO v_gen_day FROM public.school_settings WHERE id = 1;
  
  -- Mes que debió generarse (si hoy es < 25, se refiere al mes pasado. Si hoy es >= 25, es el mes actual)
  -- Realmente, si hoy es día 26, ya debería haber pagos para el mes SIGUIENTE.
  -- Vamos a simplificar: si hoy > gen_day, debería haber pagos con month_paid = mes siguiente.
  
  IF v_today < v_gen_day THEN
    RETURN jsonb_build_object('status', 'ok', 'message', 'Aun no llega el dia de generacion');
  END IF;

  v_month_key := to_char(current_date + interval '1 month', 'YYYY-MM');
  
  SELECT EXISTS (
    SELECT 1 FROM public.payments 
    WHERE month_paid = v_month_key AND concept = 'Mensualidad' AND deleted_at IS NULL
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RETURN jsonb_build_object('status', 'ok', 'message', 'Ciclo ejecutado correctamente');
  ELSE
    RETURN jsonb_build_object('status', 'error', 'message', 'El ciclo de pagos no se ha ejecutado todavia');
  END IF;
END;
$$;
