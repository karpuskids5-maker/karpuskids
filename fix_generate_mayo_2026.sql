-- ══════════════════════════════════════════════════════════════
-- fix_generate_mayo_2026.sql
-- Genera los cobros de Mayo 2026 para estudiantes activos
-- que aún no tienen registro en ese mes
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Ver qué estudiantes activos NO tienen cobro de mayo 2026
SELECT
  s.id,
  s.name,
  s.monthly_fee,
  c.name AS classroom
FROM public.students s
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
WHERE s.is_active = true
  AND s.monthly_fee > 0
  AND s.deleted_at IS NULL
  AND s.id NOT IN (
    SELECT student_id FROM public.payments
    WHERE month_paid IN ('2026-05', 'mayo', 'Mayo')
      AND (deleted_at IS NULL OR deleted_at > NOW())
  )
ORDER BY s.name;

-- 2. Insertar cobros de mayo 2026 para los que faltan
-- due_date = 5 de junio 2026 (día 5 del mes siguiente)
INSERT INTO public.payments (student_id, amount, concept, status, due_date, month_paid, created_at)
SELECT
  s.id,
  s.monthly_fee,
  'Mensualidad',
  'pending',
  '2026-06-05'::date,
  '2026-05',
  NOW()
FROM public.students s
WHERE s.is_active = true
  AND s.monthly_fee > 0
  AND s.deleted_at IS NULL
  AND s.id NOT IN (
    SELECT student_id FROM public.payments
    WHERE month_paid IN ('2026-05', 'mayo', 'Mayo')
      AND (deleted_at IS NULL OR deleted_at > NOW())
  );

-- 3. Verificar resultado
SELECT
  p.id,
  s.name AS estudiante,
  p.amount,
  p.status,
  p.due_date,
  p.month_paid
FROM public.payments p
JOIN public.students s ON s.id = p.student_id
WHERE p.month_paid = '2026-05'
ORDER BY s.name;
