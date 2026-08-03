-- ══════════════════════════════════════════════════════════════
-- fix_payment_audit_log.sql
-- Corrige el error: column "changed_by" of relation "payment_audit_log" does not exist
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Agregar columna changed_by si no existe
ALTER TABLE public.payment_audit_log
  ADD COLUMN IF NOT EXISTS changed_by uuid REFERENCES public.profiles(id);

-- 2. Agregar columna action si no existe (algunos schemas la omiten)
ALTER TABLE public.payment_audit_log
  ADD COLUMN IF NOT EXISTS action text;

-- 3. Agregar columna old_status si no existe
ALTER TABLE public.payment_audit_log
  ADD COLUMN IF NOT EXISTS old_status text;

-- 4. Agregar columna new_status si no existe
ALTER TABLE public.payment_audit_log
  ADD COLUMN IF NOT EXISTS new_status text;

-- 5. Agregar columna details si no existe
ALTER TABLE public.payment_audit_log
  ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}';

-- 6. Recrear el trigger de auditoría con manejo seguro de columnas faltantes
CREATE OR REPLACE FUNCTION public.payment_audit_trigger_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.payment_audit_log
      (payment_id, action, old_status, new_status, changed_by, details)
    VALUES (
      NEW.id,
      'status_change',
      OLD.status,
      NEW.status,
      auth.uid(),
      jsonb_build_object(
        'amount',     NEW.amount,
        'month_paid', NEW.month_paid,
        'student_id', NEW.student_id
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.payment_audit_log
      (payment_id, action, old_status, changed_by, details)
    VALUES (
      OLD.id,
      'deleted',
      OLD.status,
      auth.uid(),
      jsonb_build_object(
        'amount',     OLD.amount,
        'month_paid', OLD.month_paid
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 7. Recrear el trigger en la tabla payments
DROP TRIGGER IF EXISTS payment_audit_trigger ON public.payments;
CREATE TRIGGER payment_audit_trigger
  AFTER UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_audit_trigger_fn();

-- 8. Verificar que todo quedó bien
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'payment_audit_log'
ORDER BY ordinal_position;
