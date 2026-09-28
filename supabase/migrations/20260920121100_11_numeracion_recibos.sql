-- ============================================================================
-- 11_numeracion_recibos.sql  (CONSOLIDADA)
-- ----------------------------------------------------------------------------
-- Version unica que absorbe las antiguas migraciones 11, 12 y 13 y anade la
-- reparacion de datos que faltaba. Aplica DESPUES de la 10.
--
-- SECCIONES
--   1) Normalizador de mes ............ public.month_key(text, date)
--   2) Correlativo de recibo ......... public.payment_receipt_no(bigint)
--   3) Policy INSERT con 'review' ..... payments_parent_can_submit
--   4) REPARACION DE DATOS (nueva) ... normaliza month_paid ('agosto'/'mayo' ->
--      'YYYY-MM') y deduplica conservando el pago de mayor prioridad.
--   5) Regla anti-meses-futuros ....... fn_block_future_month_charges (ex-12)
--   6) Ciclo de pagos confiable ....... run_payment_cycle() con
--      GET DIAGNOSTICS (ex-13).
--
-- POR QUE EXISTE LA SECCION 4 (PROBLEMA QUE CIERRA)
--   propuesta.md reportaba desincronizacion entre el panel de Directora/
--   Asistente y el de Padres:
--
--   - El piso de la migracion 10 compara month_paid como TEXTO contra
--     '2026-08'. En ASCII las minusculas (0x61-0x7A) ordenan despues de los
--     digitos (0x30-0x39), asi que un nombre en espanol siempre pasa:
--        'mayo'    >= '2026-08'  -> TRUE   ('m'=0x6D > '2'=0x32; no se archiva)
--        '2026-05' >= '2026-08'  -> FALSE  (si se archiva)
--     Mismo mes, resultado opuesto segun el formato en que se guardo. Habia
--     filas 'agosto', 'mayo', '2026-08', '2026-09' mezcladas y hasta duplicados
--     (una pagada por el padre y otra pendiente generada por el ciclo).
--
--   - Consecuencia: el padre veia aprobado el mes que pago (formato 'agosto')
--     mientras la directora veia el MISMO mes como pendiente creado por
--     run_payment_cycle() con '2026-08'. Ademas el KPI "Ingresos Mes" atribuia
--     el ingreso por paid_date (base caja) en el front, de modo que septiembre
--     sumaba los pagos de mayo/agosto aprobados el 23/09 ($176,738) cuando no
--     habia cobrado nada de septiembre.
--
--   - La seccion 4 normaliza a 'YYYY-MM' (unico formato canonico) dentro del
--     periodo del ano escolar y elimina logicamente los duplicados (deleted_at),
--     conservando paid > review > overdue > pending > rejected. A partir de
--     aqui comparaciones, paneles, KPIs y recibos usan una sola clave.
--
-- IDEMPOTENTE: puede re-ejecutarse sobre la base ya desplegada sin perder
-- datos. Ejecutar en orden 01 -> 11 (ver README de migraciones).
-- ============================================================================

-- ============================================================================
-- 1) Normalizador de mes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.month_key(
  p_month     text,
  p_ref_date  date DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s text := lower(btrim(COALESCE(p_month, '')));
  n int;
BEGIN
  IF s = '' THEN
    RETURN NULL;
  END IF;

  -- '2026-08' | '2026-8'
  IF s ~ '^\d{4}-\d{1,2}$' THEN
    RETURN substr(s, 1, 5) || lpad(substr(s, 6, 2), 2, '0');
  END IF;

  -- 'agosto' | 'Septiembre' -> usa el anio de la fecha de referencia
  n := CASE s
        WHEN 'enero'      THEN 1
        WHEN 'febrero'    THEN 2
        WHEN 'marzo'      THEN 3
        WHEN 'abril'      THEN 4
        WHEN 'mayo'       THEN 5
        WHEN 'junio'      THEN 6
        WHEN 'julio'      THEN 7
        WHEN 'agosto'     THEN 8
        WHEN 'septiembre' THEN 9
        WHEN 'octubre'    THEN 10
        WHEN 'noviembre'  THEN 11
        WHEN 'diciembre'  THEN 12
      END;

  IF n IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_char(COALESCE(p_ref_date, CURRENT_DATE), 'YYYY')
         || '-' || lpad(n::text, 2, '0');
END;
$fn$;

COMMENT ON FUNCTION public.month_key(text, date) IS
  'Normaliza month_paid (YYYY-MM o nombre de mes en espanol) a la clave YYYY-MM.';

-- ============================================================================
-- 2) Correlativo de recibo
-- ============================================================================
-- 'payments_parent_see_own' limita el SELECT a is_family_member(), asi que el
-- navegador NO puede calcular el numero global del mes. Se calcula aqui con
-- SECURITY DEFINER y solo se devuelve el numero del pago solicitado.
-- Ordena por apellido+nombre del alumno, desempate por id (estable) e ignora
-- pagos con deleted_at (los anulados ya no generan hueco).
CREATE OR REPLACE FUNCTION public.payment_receipt_no(p_payment_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
DECLARE
  v_month text;
  v_ref   date;
  v_self  text;
  v_no    bigint;
BEGIN
  SELECT p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)
    INTO v_month, v_ref
    FROM public.payments p
   WHERE p.id = p_payment_id
     AND p.deleted_at IS NULL;

  -- Fallback: si el pago no existe o su mes no es interpretable, se conserva
  -- la numeracion historica basada en el id.
  v_self := public.month_key(v_month, v_ref);
  IF v_self IS NULL THEN
    RETURN 'KK-' || lpad(right(p_payment_id::text, 6), 6, '0');
  END IF;

  WITH ranked AS (
    SELECT p.id,
           row_number() OVER (
             ORDER BY COALESCE(s.last_name, '') || ' ' || COALESCE(s.name, ''), p.id
           ) AS n
      FROM public.payments p
      LEFT JOIN public.students s ON s.id = p.student_id
     WHERE p.deleted_at IS NULL
       AND public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)) = v_self
  )
  SELECT r.n INTO v_no FROM ranked r WHERE r.id = p_payment_id;

  IF v_no IS NULL THEN
    RETURN 'KK-' || lpad(right(p_payment_id::text, 6), 6, '0');
  END IF;

  RETURN 'KK-' || lpad(v_no::text, 6, '0');
END;
$fn$;

COMMENT ON FUNCTION public.payment_receipt_no(bigint) IS
  'Numero de recibo KK-000001.. sin huecos, secuencial por mes, ignorando pagos anulados.';

GRANT EXECUTE ON FUNCTION public.payment_receipt_no(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.month_key(text, date) TO authenticated, service_role;

-- Indice de apoyo para el ordenamiento por mes
CREATE INDEX IF NOT EXISTS idx_payments_month_paid
  ON public.payments (month_paid)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 3) El padre debe poder subir comprobante en estado 'review'
-- ============================================================================
-- La policy exigia status='pending', pero el panel de padre inserta
-- status='review' al subir el comprobante. Resultado: error de RLS y los
-- padres no podian registrar el pago de septiembre.
DROP POLICY IF EXISTS "payments_parent_can_submit" ON public.payments;
CREATE POLICY "payments_parent_can_submit" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_family_member(student_id)
    AND deleted_at IS NULL
    AND status IN ('pending', 'review')
  );

-- ============================================================================
-- 4) REPARACION DE DATOS: unificar month_paid y eliminar duplicados
-- ============================================================================
-- Normaliza a 'YYYY-MM' los month_paid del periodo (>= school_year_floor_month)
-- y anula logicamente los duplicados de (student_id, mes, concepto) que quedaron
-- por la mezcla de formatos 'agosto'/'2026-08', conservando el de mayor
-- prioridad: paid > review > overdue > pending > rejected.
--
-- La prioridad es 'paid' primero: una fila pagada por el padre y un pendiente
-- generado por el ciclo del mismo mes no pueden convivir; gana el pagado y la
-- directora deja de ver "pendiente" donde el padre ya cubrio.
--
-- Requiere desactivar trg_protect_paid_records durante el pase (impide tocar
-- filas 'paid'; se rehabilita al final, dentro de la misma transaccion).
DO $$
DECLARE
  r record;
  v_floor text;
  v_updated int := 0;
  v_deleted int := 0;
  v_kept    int := 0;
  v_count   int := 0;
  v_has_trigger boolean;
BEGIN
  IF to_regprocedure('public.month_key(text,date)') IS NULL THEN
    RAISE EXCEPTION 'Falta public.month_key: la seccion 1 de esta migracion debe ejecutarse antes.';
  END IF;
  IF to_regprocedure('public.school_year_floor_month()') IS NULL THEN
    RAISE EXCEPTION 'Falta public.school_year_floor_month(): aplica antes la migracion 10.';
  END IF;
  v_floor := public.school_year_floor_month();

  v_has_trigger := EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_protect_paid_records'
       AND tgrelid = 'public.payments'::regclass
  );
  IF v_has_trigger THEN
    ALTER TABLE public.payments DISABLE TRIGGER trg_protect_paid_records;
  END IF;

  BEGIN
    -- (a) Deduplicacion ANTES de normalizar: la normalizacion sola podria
    --     chocar con una fila '2026-08' que ya existia junto a una 'agosto'.
    FOR r IN
      SELECT p.id, p.student_id, p.month_paid, p.concept, p.status,
             row_number() OVER (
               PARTITION BY p.student_id,
                            public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)),
                            p.concept
               ORDER BY CASE p.status
                          WHEN 'paid'     THEN 1
                          WHEN 'review'   THEN 2
                          WHEN 'overdue'  THEN 3
                          WHEN 'pending'  THEN 4
                          WHEN 'rejected' THEN 5
                          ELSE 6 END,
                        p.created_at DESC
             ) AS rn,
             count(*) OVER (
               PARTITION BY p.student_id,
                            public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)),
                            p.concept
             ) AS dups
        FROM public.payments p
       WHERE p.deleted_at IS NULL
         AND public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)) IS NOT NULL
    LOOP
      IF r.dups > 1 THEN
        IF r.rn = 1 THEN
          v_kept := v_kept + 1;
        ELSE
          UPDATE public.payments
             SET deleted_at = now(),
                 notes = COALESCE(notes, '')
                         || format(' | Anulado por migracion 11: duplicado de mes %s (%s), se conserva la fila pagada.',
                                   r.month_paid, r.status)
           WHERE id = r.id;
          v_deleted := v_deleted + 1;
        END IF;
      END IF;
    END LOOP;

    -- (b) Normalizacion de la fila conservada: solo dentro del piso
    --     (payments_month_floor_check, NOT VALID, se aplica a UPDATE) y nunca
    --     por debajo de '2026-08'. El historial pagado previo al periodo se
    --     conserva tal cual (es dinero recibido).
    FOR r IN
      SELECT p.id,
             public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date)) AS k
        FROM public.payments p
       WHERE p.deleted_at IS NULL
         AND p.month_paid IS NOT NULL
         AND p.month_paid <> public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date))
    LOOP
      IF r.k IS NOT NULL AND r.k >= v_floor THEN
        UPDATE public.payments SET month_paid = r.k WHERE id = r.id;
        v_updated := v_updated + 1;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    IF v_has_trigger THEN
      ALTER TABLE public.payments ENABLE TRIGGER trg_protect_paid_records;
    END IF;
    RAISE;
  END;

  IF v_has_trigger THEN
    ALTER TABLE public.payments ENABLE TRIGGER trg_protect_paid_records;
  END IF;

  -- (c) Auditoria del pase de reparacion.
  SELECT count(*) INTO v_count FROM public.payments
   WHERE deleted_at IS NULL
     AND public.month_key(month_paid, COALESCE(paid_date::date, created_at::date)) > to_char(CURRENT_DATE, 'YYYY-MM');
  IF (v_updated + v_deleted) > 0 THEN
    INSERT INTO public.audit_logs (user_id, action, payload)
    VALUES (NULL, 'payment.data_normalized', jsonb_build_object(
      'floor_month',       v_floor,
      'months_normalized', v_updated,
      'duplicates_voided', v_deleted,
      'duplicates_kept',   v_kept,
      'future_charges_left', v_count,
      'reason', 'Migracion 11 consolidada: unificar month_paid a YYYY-MM y deduplicar conservando paid'
    ));
  END IF;

  RAISE NOTICE
    'Migracion 11: % mes(es) normalizado(s), % duplicado(s) anulado(s), % conservado(s). Cargos futuros restantes: %.',
    v_updated, v_deleted, v_kept, v_count;
END;
$$;

-- ============================================================================
-- 5) Regla anti-meses-futuros (absorbida de la antigua 12)
-- ============================================================================
-- REGLA FIRME: un cargo no puede pertenecer a un mes posterior al mes en curso.
-- Va en un TRIGGER porque es el unico punto que no depende de quien escribe y
-- no se puede esquivar desde la UI. month_paid se normaliza con month_key() y
-- se compara como texto 'YYYY-MM' (orden lexicografico correcto). Si el mes no
-- se puede interpretar (vacio o texto libre) no se bloquea: los conceptos
-- sueltos ('Materiales', 'Matricula') deben poder registrarse sin fecha.
CREATE OR REPLACE FUNCTION public.fn_block_future_month_charges()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_key text;
  v_now text := to_char(CURRENT_DATE, 'YYYY-MM');
BEGIN
  v_key := public.month_key(
             NEW.month_paid,
             COALESCE(NEW.paid_date::date, NEW.created_at::date, CURRENT_DATE)
           );

  IF v_key IS NOT NULL AND v_key > v_now THEN
    -- Los dos % del mensaje se sustituyen con los argumentos que van despues.
    -- Sin ellos PL/pgSQL aborta al compilar: "too few parameters specified".
    RAISE EXCEPTION
      'No se pueden generar cargos de meses futuros: % (mes actual %). El cargo de un mes se crea el dia de generacion de ese mes.',
      v_key, v_now
      USING ERRCODE = 'check_violation', HINT = 'Usa el mes en curso o uno anterior.';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_block_future_month_charges() IS
  'Impide que un cargo de payments pertenezca a un mes posterior al mes en curso.';

DROP TRIGGER IF EXISTS trg_block_future_month_charges ON public.payments;
CREATE TRIGGER trg_block_future_month_charges
  BEFORE INSERT OR UPDATE OF month_paid ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_future_month_charges();

-- Mismo criterio para el ciclo automatico, por si alguien lo parametriza.
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.payments p
   WHERE p.deleted_at IS NULL
     AND public.month_key(p.month_paid, COALESCE(p.paid_date::date, p.created_at::date))
           > to_char(CURRENT_DATE, 'YYYY-MM');

  IF v_bad > 0 THEN
    RAISE WARNING
      'Hay % cargo(s) de meses futuros todavia sin anular. El trigger ya los bloquea, pero no los borra: anulalos con UPDATE payments SET deleted_at = now() WHERE id IN (...)',
      v_bad;
  END IF;
END;
$$;

-- ============================================================================
-- 6) Ciclo de pagos con contador confiable (absorbida de la antigua 13)
-- ============================================================================
-- Corrige el contador 'generated' de run_payment_cycle(): se apoyaba en el
-- flag FOUND de PL/pgSQL tras INSERT ... ON CONFLICT DO NOTHING, que no es
-- fiable con esa forma. La forma idiomatica es GET DIAGNOSTICS ... = ROW_COUNT,
-- que lee el conteo real de la ultima sentencia. El resto de la logica del
-- ciclo (dia de generacion, piso del ano escolar, monto con descuento, Dia
-- Prolongado, marcado de vencidos) queda byte a byte igual a la 10.
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         text;
  v_gen_day      int;
  v_due_day      int;
  v_now          date    := current_date;
  v_floor        text;
  v_target_month text;
  v_due_date     date;
  v_last_day     date;
  v_generated    int := 0;
  v_expired      int := 0;
  v_rows         int := 0;
  v_student      record;
  v_amount       numeric;
  v_original     numeric;
  v_disc         numeric;
BEGIN
  BEGIN
    SELECT COALESCE(role,'') INTO v_role FROM public.profiles WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN v_role := NULL; END;
  IF auth.uid() IS NOT NULL AND v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION
      'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_floor        := public.school_year_floor_month();
  v_target_month := to_char(v_now, 'YYYY-MM');

  -- Blindaje: fuera del periodo 2026-2027 el ciclo no genera nada.
  IF v_target_month < v_floor THEN
    RETURN jsonb_build_object(
      'generated', 0, 'expired', 0, 'month', v_target_month,
      'generation_day', v_gen_day, 'floor_month', v_floor,
      'skipped', format('mes anterior al inicio del ano escolar (%s)', v_floor));
  END IF;

  v_due_date := (date_trunc('month', v_now + interval '1 month')
                 + (v_due_day - 1) * interval '1 day')::date;
  v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  -- Regla del dia 25: antes del dia de generacion solo se vencen cobros, no
  -- se crean nuevos. Asi el padre no ve cargos que aun no corresponden.
  IF EXTRACT(DAY FROM v_now)::int >= v_gen_day THEN
    FOR v_student IN
      SELECT s.id, COALESCE(s.monthly_fee,0) AS monthly_fee,
             COALESCE(s.prolongado_fee,0) AS prolongado_fee,
             s.start_date
      FROM public.students s
      WHERE s.is_active = true
        AND COALESCE(s.monthly_fee,0) > 0
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.student_id = s.id
            AND p.month_paid = v_target_month
            AND p.concept = 'Mensualidad'
            AND p.deleted_at IS NULL
        )
    LOOP
      IF v_student.start_date IS NOT NULL AND v_student.start_date > v_last_day THEN
        CONTINUE;
      END IF;

      v_original := v_student.monthly_fee;
      v_amount   := public.get_monthly_fee_for(v_student.id);
      v_disc     := CASE WHEN v_original > 0
                         THEN round(((v_original - v_amount) / v_original * 100)::numeric, 2)
                         ELSE 0 END;

      INSERT INTO public.payments
        (student_id, amount, original_amount, discount_pct, discount_amount,
         status, due_date, month_paid, concept, created_at)
      VALUES
        (v_student.id, v_amount, v_original, v_disc, round((v_original - v_amount)::numeric, 2),
         'pending', v_due_date, v_target_month, 'Mensualidad', now())
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_generated := v_generated + COALESCE(v_rows, 0);

      IF COALESCE(v_student.prolongado_fee, 0) > 0 THEN
        INSERT INTO public.payments
          (student_id, amount, original_amount, discount_pct, discount_amount,
           status, due_date, month_paid, concept, created_at)
        VALUES
          (v_student.id, v_student.prolongado_fee, v_student.prolongado_fee, 0, 0,
           'pending', v_due_date, v_target_month, 'Dia Prolongado', now())
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_generated := v_generated + COALESCE(v_rows, 0);
      END IF;
    END LOOP;
  END IF;

  -- Vencimiento: solo dentro del periodo. Un pendiente de mayo 2026 no se
  -- convierte en 'overdue' (eso es exactamente la deuda que se quiere quitar).
  UPDATE public.payments
     SET status = 'overdue', updated_at = now()
   WHERE status = 'pending'
     AND due_date IS NOT NULL
     AND due_date < v_now
     AND deleted_at IS NULL
     AND (month_paid IS NULL OR month_paid >= v_floor);
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'generated',     v_generated,
    'expired',       v_expired,
    'month',         v_target_month,
    'due_date',      v_due_date::text,
    'generation_day', v_gen_day,
    'floor_month',   v_floor,
    'skipped',       CASE WHEN EXTRACT(DAY FROM v_now)::int < v_gen_day
                          THEN 'antes del dia de generacion (' || v_gen_day || ')' END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated, service_role;

COMMENT ON FUNCTION public.run_payment_cycle() IS
  'Genera los cargos del mes en curso (dia generation_day) y vence los pendientes. generated cuenta filas realmente insertadas.';

-- ============================================================================
-- Verificacion tras aplicar
--   SELECT public.month_key('agosto', DATE '2026-09-15');            -- 2026-08
--   SELECT month_paid, count(*) FROM public.payments
--     WHERE deleted_at IS NULL GROUP BY month_paid ORDER BY month_paid; -- todo YYYY-MM
--   SELECT public.payment_receipt_no(<id_de_un_pago_pagado>);        -- KK-000001
--   SELECT public.run_payment_cycle();                                -- generated: 0 (sept ya generado) pero fiable
--   -- Debe fallar:
--   INSERT INTO payments (student_id, amount, status, month_paid, concept)
--   VALUES (58, 3250, 'pending', '2026-10', 'Mensualidad');
-- ============================================================================