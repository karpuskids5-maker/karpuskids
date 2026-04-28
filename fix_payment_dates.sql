-- ============================================================
-- FIX: Corregir fechas y duplicados de pagos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Corregir due_date de pagos de Abril 2026 (vence 5 de Mayo, no 5 de Abril)
UPDATE public.payments
SET due_date = '2026-05-05', status = 'pending'
WHERE month_paid = '2026-04'
  AND due_date < '2026-05-01'
  AND status IN ('pending', 'overdue');

-- 2. ELIMINAR pagos de Mayo 2026 generados prematuramente
--    Mayo no debe generarse hasta el dia 25 de Mayo
DELETE FROM public.payments
WHERE month_paid = '2026-05'
  AND status IN ('pending', 'overdue');

-- 3. Eliminar cualquier otro duplicado por estudiante+mes
DELETE FROM public.payments
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY student_id, month_paid
             ORDER BY
               CASE status
                 WHEN 'paid'       THEN 1
                 WHEN 'pagado'     THEN 1
                 WHEN 'confirmado' THEN 1
                 WHEN 'review'     THEN 2
                 ELSE 3
               END,
               id DESC
           ) AS rn
    FROM public.payments
    WHERE month_paid IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 4. Verificar resultado final
SELECT student_id, month_paid, due_date, status, amount
FROM public.payments
ORDER BY student_id, month_paid;
