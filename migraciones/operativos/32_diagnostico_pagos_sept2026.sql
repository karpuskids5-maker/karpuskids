-- DIAGNÓSTICO: ver todos los pagos activos de estudiantes nuevos sept 2026
-- Corre esto en SQL Editor para ver qué hay exactamente en BD
SELECT
  s.name,
  s.last_name,
  s.monthly_fee,
  p.id          AS payment_id,
  p.concept,
  p.amount,
  p.status,
  p.due_date,
  p.month_paid,
  p.created_at,
  p.deleted_at
FROM public.students s
JOIN public.payments p ON p.student_id = s.id
WHERE s.is_active = true
  AND s.deleted_at IS NULL
  AND to_char(s.start_date, 'YYYY-MM') = '2026-09'
ORDER BY s.name, p.created_at DESC;
