-- ============================================================
-- 🔧 Fix: Sistema de Mora — Karpus Kids
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Agregar columna last_reminder_sent a payments (si no existe)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS last_reminder_sent timestamptz DEFAULT NULL;

-- 2. Índice para consultas de recordatorios eficientes
CREATE INDEX IF NOT EXISTS idx_payments_overdue_reminder
  ON public.payments (status, due_date, last_reminder_sent)
  WHERE status = 'overdue';

-- 3. Función para quitar mora de un pago específico
--    Resetea due_date a hoy (para que la mora calculada sea 0)
--    y registra una nota de la exoneración.
CREATE OR REPLACE FUNCTION public.waive_payment_mora(
  p_payment_id bigint,
  p_reason     text DEFAULT 'Mora exonerada por administración'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pago no encontrado');
  END IF;

  -- Resetear due_date a hoy para que calculateMora() devuelva 0
  UPDATE public.payments
  SET
    due_date           = CURRENT_DATE,
    last_reminder_sent = NULL,
    notes              = COALESCE(notes || ' | ', '') || p_reason || ' (' || to_char(now(), 'DD/MM/YYYY') || ')'
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'new_due_date', CURRENT_DATE,
    'reason', p_reason
  );
END;
$$;

-- 4. Función para eliminar mora completamente (soft reset)
--    Útil si quieres que el pago vuelva a "pending" sin mora
CREATE OR REPLACE FUNCTION public.reset_payment_to_pending(
  p_payment_id bigint,
  p_reason     text DEFAULT 'Reiniciado por administración'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payments
  SET
    status             = 'pending',
    due_date           = CURRENT_DATE + INTERVAL '7 days',
    last_reminder_sent = NULL,
    notes              = COALESCE(notes || ' | ', '') || p_reason || ' (' || to_char(now(), 'DD/MM/YYYY') || ')'
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Pago no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- 5. Grant de ejecución a roles autenticados
GRANT EXECUTE ON FUNCTION public.waive_payment_mora(bigint, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_payment_to_pending(bigint, text) TO authenticated;
