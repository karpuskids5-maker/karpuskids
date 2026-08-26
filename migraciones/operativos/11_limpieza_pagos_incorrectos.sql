-- ══════════════════════════════════════════════════════════════
-- LIMPIEZA TOTAL: Eliminar TODOS los pagos que no sean Agosto 2026
-- ══════════════════════════════════════════════════════════════

-- 1) VER todo lo que hay en payments
SELECT id, student_id, month_paid, concept, status, amount, deleted_at
FROM public.payments
ORDER BY month_paid, student_id;

-- 2) Borrar SOFT-DELETE todo lo que NO sea Agosto 2026
--    Incluye variantes en español ('mayo', 'Mayo', 'septiembre', etc.) y formato YYYY-MM
UPDATE public.payments
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND lower(trim(month_paid)) NOT IN ('agosto', '2026-08');

-- 3) Verificar que solo queda Agosto 2026
SELECT id, student_id, month_paid, concept, status, amount, deleted_at
FROM public.payments
WHERE deleted_at IS NULL
ORDER BY student_id;

-- 4) Contar lo que quedó
SELECT count(*) AS pagos_agosto FROM public.payments WHERE deleted_at IS NULL;
