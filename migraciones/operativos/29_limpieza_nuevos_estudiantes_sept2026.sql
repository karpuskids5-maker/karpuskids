-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 29: Limpieza de pagos incorrectos — nuevos estudiantes Sept 2026
-- ─────────────────────────────────────────────────────────────────────────
-- PROBLEMA:
--   Todos los estudiantes con start_date en septiembre 2026 tienen:
--   · Inscripción vencida el 5/9 (antes de su matrícula del 12/9)
--   · Mensualidades Oct 2026 – Jun 2027 pre-generadas (no corresponde aún)
--   · Montos incorrectos en algunos casos
--
-- REGLA:
--   Para estudiantes con start_date en '2026-09':
--   1. Archivar (soft-delete) todos sus pagos pendientes/vencidos actuales
--   2. Eliminar sus student_charges erróneos
--   3. Crear UN SOLO cobro: Mensualidad 2026-09, monto = monthly_fee real,
--      vence 2026-09-25, status = pending
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_student       RECORD;
  v_gen_day       int := 25;
  v_first_due     date := '2026-09-25';
  v_target_month  text := '2026-09';
  v_fixed_count   int := 0;
BEGIN
  -- Leer generation_day real por si fue modificado
  SELECT COALESCE(generation_day, 25) INTO v_gen_day
  FROM public.school_settings WHERE id = 1;
  v_first_due := make_date(2026, 9, v_gen_day);

  -- Deshabilitar trigger si existe (evita re-generación automática)
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment'
      AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students DISABLE TRIGGER trg_sync_month_payment;
  END IF;

  -- Iterar sobre todos los estudiantes activos con start_date en sept 2026
  FOR v_student IN
    SELECT s.id, s.name, s.last_name, s.monthly_fee
    FROM public.students s
    WHERE s.is_active = true
      AND s.deleted_at IS NULL
      AND to_char(s.start_date, 'YYYY-MM') = v_target_month
      -- Solo tocar si tienen cobros problemáticos: inscripción vencida o
      -- mensualidades de meses futuros pre-generadas
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id
          AND p.deleted_at IS NULL
          AND p.status IN ('pending', 'overdue')
          AND (
            -- Inscripción con due_date antes del día 25 del mismo mes
            (p.concept = 'Inscripción' AND p.due_date < v_first_due)
            OR
            -- Mensualidades de meses futuros (oct en adelante) pre-generadas
            (p.concept = 'Mensualidad' AND p.month_paid > v_target_month)
          )
      )
  LOOP
    RAISE NOTICE 'Corrigiendo estudiante: % % (id=%)', v_student.name, v_student.last_name, v_student.id;

    -- 1. Archivar (soft-delete) TODOS los pagos pendientes/vencidos del estudiante
    UPDATE public.payments
       SET deleted_at = now(), updated_at = now()
     WHERE student_id = v_student.id
       AND deleted_at IS NULL
       AND status IN ('pending', 'overdue');

    -- 2. Eliminar student_charges erróneos (no tienen soft-delete)
    DELETE FROM public.student_charges
     WHERE student_id = v_student.id
       AND status IN ('pending', 'overdue');

    -- 3. Crear el ÚNICO cobro correcto: Mensualidad septiembre
    --    Prioridad de monto: (a) monthly_fee del estudiante si > 0,
    --    (b) monto del pago de Mensualidad septiembre recién archivado,
    --    (c) fallback 1500
    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, month_paid, created_at)
    SELECT
      v_student.id,
      COALESCE(
        NULLIF(v_student.monthly_fee, 0),
        -- Recuperar el monto de la mensualidad de sept que acabamos de archivar
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC LIMIT 1),
        1500
      ),
      'Mensualidad',
      'pending',
      v_first_due,
      v_target_month,
      now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payments
      WHERE student_id = v_student.id
        AND concept = 'Mensualidad'
        AND month_paid = v_target_month
        AND deleted_at IS NULL
    );

    -- 4. Crear el cargo equivalente en student_charges
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net,
       month_paid, due_date, status, created_by)
    SELECT
      v_student.id,
      'Mensualidad',
      'mensualidad',
      COALESCE(NULLIF(v_student.monthly_fee, 0),
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NULL
         LIMIT 1),
        1500
      ),
      0,
      COALESCE(NULLIF(v_student.monthly_fee, 0),
        (SELECT amount FROM public.payments
         WHERE student_id = v_student.id
           AND concept = 'Mensualidad'
           AND month_paid = v_target_month
           AND deleted_at IS NULL
         LIMIT 1),
        1500
      ),
      v_target_month,
      v_first_due,
      'pending',
      (SELECT id FROM public.profiles WHERE role = 'directora' LIMIT 1)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_charges
      WHERE student_id = v_student.id
        AND type = 'mensualidad'
        AND month_paid = v_target_month
    );

    v_fixed_count := v_fixed_count + 1;
  END LOOP;

  -- Reactivar trigger
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_month_payment'
      AND tgrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students ENABLE TRIGGER trg_sync_month_payment;
  END IF;

  RAISE NOTICE 'Total de estudiantes corregidos: %', v_fixed_count;
END;
$$;
