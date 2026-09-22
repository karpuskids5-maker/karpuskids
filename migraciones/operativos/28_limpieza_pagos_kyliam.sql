-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 28: Limpieza de pagos incorrectos de Kyliam (matrícula nueva)
-- ─────────────────────────────────────────────────────────────────────────
-- PROBLEMA (migración 27 donde se documenta el origen):
--   En la matrícula del 12/9/2026 se generó el plan completo con montos por
--   defecto y fechas ya vencidas:
--     · Inscripción 2,000 vence 5/9 (antes de matricularse) → nació vencida
--     · Mensualidad 4,500 (monto por defecto, no la cuota real)
--     · Día Prolongado 1,500 (NO aplica — el plan es solo mensualidad)
--     · Duplicados y filas huérfanas (meses Malformados)
--   Resultado: el padre ve 10 pagos pendientes, una inscripción con recargo
--   y montos incorrectos, cuando solo debe existir la mensualidad de
--   septiembre con vencimiento el día 25.
--
-- REGLA APLICADA (Kyliam):
--   1. Se eliminan TODOS los pagos y cargos erróneos del estudiante.
--   2. Queda ÚNICAMENTE: Mensualidad Septiembre 2026 = RD$1,500,
--      vence 25/9/2026, pendiente.
--   3. Config financiera: monthly_fee = 1,500 · prolongado_fee = 0 ·
--      due_day = 5.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_student_id bigint;
BEGIN
  -- Identificar al estudiante (Kyliam Jatniel Lorenzo Correa)
  SELECT id INTO v_student_id
  FROM public.students
  WHERE name ILIKE 'Kyliam%'
    AND last_name ILIKE '%Lorenzo%'
  ORDER BY id
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE NOTICE 'No se encontró al estudiante Kyliam. Nada por hacer.';
    RETURN;
  END IF;

  RAISE NOTICE 'Limpiando pagos del estudiante %', v_student_id;

  -- 1. Evitar que el trigger de cobro automático (sync_current_month_payment)
  --    cree un cargo no deseado al actualizar students.monthly_fee abajo.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment' AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students DISABLE TRIGGER trg_sync_month_payment;
  END IF;

  BEGIN
    -- 2. Pagos: archivar (soft-delete) todos los del estudiante
    UPDATE public.payments
       SET deleted_at = now(), updated_at = now()
     WHERE student_id = v_student_id
       AND deleted_at IS NULL;

    -- 3. Cargos: eliminar definitivamente (student_charges no tiene deleted_at)
    DELETE FROM public.student_charges
     WHERE student_id = v_student_id;

    -- 4. Crear el ÚNICO cargo correcto: Mensualidad sept. vence 25/9
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net,
       month_paid, due_date, status, created_by)
    SELECT v_student_id, 'Mensualidad', 'mensualidad', 1500, 0, 1500,
           '2026-09', '2026-09-25', 'pending', auth.uid()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_charges
      WHERE student_id = v_student_id AND type = 'mensualidad' AND month_paid = '2026-09'
    );

    -- 5. Crear el pago equivalente en payments (mismo mes)
    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, month_paid, created_at)
    SELECT v_student_id, 1500, 'Mensualidad', 'pending', '2026-09-25', '2026-09', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = v_student_id AND concept = 'Mensualidad'
        AND month_paid = '2026-09' AND deleted_at IS NULL
    );

    -- 6. Config financiera real del estudiante
    --    (students NO tiene columna updated_at)
    UPDATE public.students
       SET monthly_fee    = 1500,
           prolongado_fee = 0,
           due_day        = 5,
           discount_pct   = 0
     WHERE id = v_student_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;

  -- 7. Reactivar el trigger de cobro automático
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment' AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students ENABLE TRIGGER trg_sync_month_payment;
  END IF;

  RAISE NOTICE 'Pagos de Kyliam corregidos: solo Mensualidad 09/2026 (1,500) vence 25/9/2026.';
END;
$$;