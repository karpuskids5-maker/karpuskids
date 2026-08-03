-- ============================================================ 
-- 🛡️ REGLAS DE SEGURIDAD Y VALIDACIÓN DE PAGOS 2026 
-- ============================================================ 
-- Ejecutar en Supabase SQL Editor
-- Fecha: Junio 28, 2026
-- ============================================================

-- 1. Reforzar approve_payment: Impedir aprobación sin comprobante (excepto efectivo)
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL) 
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ 
DECLARE 
  v_role text; 
  v_payment record; 
  has_proof boolean;
BEGIN 
  -- Verificar rol 
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid(); 
  IF v_role NOT IN ('directora','asistente','admin') THEN 
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos'); 
  END IF; 
 
  -- Obtener datos del pago 
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id; 
  IF NOT FOUND THEN 
    RETURN jsonb_build_object('error','El pago no existe'); 
  END IF; 
 
  -- REGLA: No se puede aprobar si no hay comprobante (proof_url O evidence_url) Y no es efectivo
  has_proof := (v_payment.proof_url IS NOT NULL AND v_payment.proof_url <> '') OR 
               (v_payment.evidence_url IS NOT NULL AND v_payment.evidence_url <> '');
  IF NOT has_proof AND (v_payment.method IS DISTINCT FROM 'efectivo') THEN 
    RETURN jsonb_build_object('error','No se puede aprobar un pago por transferencia sin comprobante visual cargado'); 
  END IF; 
 
  -- Proceder con la aprobación 
  UPDATE public.payments 
  SET 
    status='paid', 
    paid_date=now(), 
    validated_by=auth.uid(), 
    notes=COALESCE(p_notes, notes, 'Aprobado vía sistema') 
  WHERE id = p_payment_id; 
 
  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id); 
END; 
$$; 
 
-- 2. Trigger para pasar a "review" automáticamente cuando se sube evidencia 
CREATE OR REPLACE FUNCTION public.fn_on_payment_evidence_uploaded() 
RETURNS trigger LANGUAGE plpgsql AS $$ 
BEGIN 
  -- Si el estado era "pending" o "overdue" y se sube un proof_url o evidence_url, pasar a "review"
  IF ((NEW.proof_url IS NOT NULL AND NEW.proof_url <> '') AND (OLD.proof_url IS NULL OR OLD.proof_url = '')) OR
     ((NEW.evidence_url IS NOT NULL AND NEW.evidence_url <> '') AND (OLD.evidence_url IS NULL OR OLD.evidence_url = '')) THEN
    IF NEW.status IN ('pending', 'overdue') THEN 
      NEW.status := 'review'; 
      NEW.notes := COALESCE(NEW.notes || ' | ', '') || 'Comprobante subido por usuario - Pendiente de validación'; 
    END IF; 
  END IF; 
  RETURN NEW; 
END; 
$$; 
 
DROP TRIGGER IF EXISTS trg_on_evidence_uploaded ON public.payments; 
CREATE TRIGGER trg_on_evidence_uploaded 
  BEFORE UPDATE OF proof_url, evidence_url ON public.payments 
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_payment_evidence_uploaded(); 
 
-- 3. Regla de Integridad: Impedir borrar pagos ya aprobados 
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records() 
RETURNS trigger LANGUAGE plpgsql AS $$ 
BEGIN 
  IF OLD.status = 'paid' AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin') THEN 
    RAISE EXCEPTION 'No se puede modificar o eliminar un registro de pago que ya ha sido validado y aprobado por la dirección.'; 
  END IF; 
  RETURN OLD; 
END; 
$$; 
 
DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments; 
CREATE TRIGGER trg_protect_paid_records 
  BEFORE UPDATE OR DELETE ON public.payments 
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records(); 
 
-- 4. Nueva lógica de Mora (Centralizada) 
-- Regla: 
-- • Días 1 al 6 de atraso: RD$50 por día 
-- • Día 7 (primer bloque): Se convierte en RD$500 acumulados 
-- • Después del día 7: +RD$50 por día adicional 
-- • Cada 7 días (nuevo bloque): +RD$500 adicionales 
-- • Fórmula: (bloques de 7 días × RD$500) + (días restantes × RD$50) 
CREATE OR REPLACE FUNCTION public.calculate_mora_v2( 
  p_amount numeric, 
  p_due_date date, 
  p_status text 
) 
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$ 
DECLARE 
  v_days_late int; 
  v_mora numeric := 0; 
  v_bloques int;
  v_dias_restantes int;
BEGIN 
  IF p_status = 'paid' OR p_status = 'rejected' OR p_due_date >= CURRENT_DATE THEN 
    RETURN 0; 
  END IF; 
 
  v_days_late := (CURRENT_DATE - p_due_date)::int; 
  
  -- Calcular bloques completos de 7 días y días restantes
  v_bloques := FLOOR(v_days_late / 7);
  v_dias_restantes := v_days_late % 7;
  
  -- Aplicar fórmula: (bloques × 500) + (días restantes × 50)
  v_mora := (v_bloques * 500) + (v_dias_restantes * 50); 
 
  RETURN v_mora; 
END; 
$$; 
 
-- 5. Actualizar vista para usar la nueva mora 
DROP VIEW IF EXISTS public.v_payments_with_mora; 
CREATE VIEW public.v_payments_with_mora AS 
SELECT 
  p.*, 
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS calculated_mora,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS mora_amount,
  (p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)) AS total_due, 
  s.name AS student_name, 
  c.name AS classroom_name 
FROM public.payments p 
LEFT JOIN public.students s ON s.id = p.student_id 
LEFT JOIN public.classrooms c ON c.id = s.classroom_id 
WHERE p.deleted_at IS NULL;

-- 6. Grant de ejecución a roles autenticados
GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;