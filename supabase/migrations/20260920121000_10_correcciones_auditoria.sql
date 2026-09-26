-- ==========================================================================
-- KARPUS KIDS / MIGRACION CONSOLIDADA 10/10 - CORRECCIONES DE AUDITORIA
-- ==========================================================================
-- Corrige los defectos encontrados al auditar los 36 archivos de
-- migraciones/operativos/ y los 8 de supabase/migrations/ (44 fuentes).
-- Esta migracion y las 9 anteriores son las unicas que se conservan: las 44
-- fuentes originales se eliminaron del repositorio tras consolidar y corregir
-- sus defectos.
--
-- IDEMPOTENTE. Aplicar DESPUES de 01 -> 09.
--
-- Indice de correcciones
--   A. Eliminacion de tablas y columnas muertas
--   A2. Indice unico (student_id, month_paid): impedia 2 cargos/mes
--   A3. Trigger de reinscripcion que leia payments.recorded_by
--   B. fn_protect_paid_records: el DELETE era un no-op silencioso   [CRITICO]
--   C. fn_protect_payment_financials: un padre reescribia el monto  [CRITICO]
--   D. get_morosidad_report: RPC llamada por el panel y sin existir [ALTO]
--   E. Unificacion del vocabulario de estados (rechazado -> rejected)[ALTO]
--   F. generate_annual_payments / pay_full_year usaban el modelo viejo
--   G. Simetria de la RLS familiar en INSERT de comprobantes
--   H. run_payment_cycle y sync_current_month_payment (regla del dia 25)
--   I. v_payments_with_mora recreada sin las columnas eliminadas
--   J. Bucket 'posts' del muro + limite de 25 MB en classroom_media
--   K. post_views: deduplicacion real de visualizaciones
--   L. Crons sin placeholders: tabla cron_endpoints
--   N. Periodo escolar 2026-2027: piso de cobros en agosto 2026 y
--      liquidacion de la deuda de meses anteriores (mayo, junio, julio, ...)
-- ==========================================================================

BEGIN;

-- ==========================================================================
-- 0. RECREACION DE LAS FUNCIONES QUE SOLO EXISTEN EN LA BASE REMOTA
-- ==========================================================================
-- Estas seis funciones no estan en las migraciones 01-09 (por eso las secciones
-- que las crean son nuevas en este archivo), pero SI existen en la base remota:
-- vinieron de las 36 migraciones legacy de migraciones/operativos/ que se
-- descartaron al consolidar, y despues el dashboard las fue parcheando a mano.
-- Sus firmas no coinciden con las de aqui, asi que CREATE OR REPLACE aborta:
--   42P13 cannot change name of input parameter "p_discount"
--   42P13 cannot change return type of existing function
-- CREATE OR REPLACE solo admite cambiar el CUERPO: la firma (tipos, nombres de
-- parametros y fila de retorno) es inmutable mientras la funcion exista. Se
-- DROPean todas las sobrecargas de las seis antes de crearlas.
--
-- CASCADE hace falta porque fn_protect_payment_financials tiene un trigger
-- (trg_protect_payment_financials): se cae con ella y la seccion C lo vuelve a
-- crear mas abajo, en este mismo archivo. Ninguna otra tiene dependents: en
-- 01-09 solo aparecen en GRANT EXECUTE.
DO $$
DECLARE
  v_nombre text;
  v_fn     record;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY[
    'fn_protect_payment_financials',
    'generate_annual_payments',
    'get_monthly_fee_for',
    'get_morosidad_report',
    'pay_full_year',
    'school_year_floor_month'
  ]
  LOOP
    FOR v_fn IN
      SELECT p.oid::regprocedure::text AS firma
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_nombre
    LOOP
      RAISE NOTICE 'Se elimina la version legada de %: %', v_nombre, v_fn.firma;
      EXECUTE 'DROP FUNCTION IF EXISTS ' || v_fn.firma || ' CASCADE';
    END LOOP;
  END LOOP;
END $$;

-- ==========================================================================
-- A. ELIMINACION DE TABLAS Y COLUMNAS MUERTAS
-- ==========================================================================
-- payment_audit_log  : se creo y se protegio, pero la auditoria real la
--                      escribe fn_audit_payment() en public.audit_logs
--                      (acciones 'payment.*'). Nunca recibio un INSERT.
-- payment_plans      : segundo modelo de pago paralelo, abandonado. El
-- payment_installments: sistema real usa public.payments directamente.
--                      Ambas tienen RLS sin una sola policy: selladas.
-- payments.recorded_by   : 0 usos en JS/TS y en SQL.
-- payments.transfer_date : 0 usos en JS/TS y en SQL (el comprobante se valida
--                           con paid_date / proof_url / evidence_url).

-- En la base remota sobreviven objetos de las migraciones viejas que apuntan a
-- estas tablas (por ejemplo public.v_financial_dashboard -> payment_installments).
-- Postgres aborta el DROP TABLE con 2BP01 si queda alguno vivo, y solo reporta
-- el primero: por eso se resuelven TODOS los dependientes antes de eliminar la
-- tabla, en vez de hardcodear un unico nombre. Son objetos muertos por
-- definicion: si leen una tabla que se declara muerta, tambien lo estan.
DO $$
DECLARE
  v_tabla   text;
  v_oid     oid;
  v_vistas  text;
  v_rondas  int := 0;
  v_fn      record;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['payment_audit_log','payment_installments','payment_plans']
  LOOP
    SELECT c.oid INTO v_oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_tabla;
    CONTINUE WHEN v_oid IS NULL;

    -- Vistas de public que leen la tabla, directa o indirectamente: el ciclo
    -- se repite hasta que no quede ninguna.
    LOOP
      v_rondas := v_rondas + 1;
      IF v_rondas > 50 THEN
        RAISE EXCEPTION 'Dependencias circulares al eliminar vistas de public.%', v_tabla;
      END IF;

      SELECT string_agg(DISTINCT format('%I', c.relname), ', ')
        INTO v_vistas
        FROM pg_depend d
        JOIN pg_rewrite  w ON w.oid = d.objid
        JOIN pg_class    c ON c.oid = w.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE d.classid    = 'pg_rewrite'::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid   = v_oid
         AND c.relkind    = 'v'
         AND n.nspname    = 'public';

      EXIT WHEN v_vistas IS NULL;

      RAISE NOTICE 'Vistas dependientes de public.%: %', v_tabla, v_vistas;
      EXECUTE 'DROP VIEW IF EXISTS public.' || v_vistas || ' CASCADE';
    END LOOP;

    -- Funciones SQL que la consultan (las plpgsql no generan dependencia).
    FOR v_fn IN
      SELECT p.oid AS oid
        FROM pg_depend d
        JOIN pg_proc p ON p.oid = d.objid
       WHERE d.classid    = 'pg_proc'::regclass
         AND d.refclassid = 'pg_class'::regclass
         AND d.refobjid   = v_oid
         AND d.deptype    IN ('n','a')
    LOOP
      RAISE NOTICE 'Funcion dependiente de public.%: %', v_tabla, v_fn.oid::regprocedure::text;
      EXECUTE 'DROP FUNCTION IF EXISTS ' || v_fn.oid::regprocedure::text || ' CASCADE';
    END LOOP;
  END LOOP;
END $$;

-- En una sola sentencia: si alguna de las tres referenciaba a otra, tres
-- DROP sueltos fallarian por 2BP01 en el orden equivocado.
DROP TABLE IF EXISTS public.payment_audit_log,
                   public.payment_installments,
                   public.payment_plans;

-- Las columnas que se eliminan abajo tambien estan expuestas por vistas. La
-- 08 creo public.v_payments_with_mora con SELECT p.*, y eso congela la
-- referencia de la vista a la columna: el ALTER ... DROP COLUMN aborta con
-- 2BP01 ("view v_payments_with_mora depends on column recorded_by") aunque la
-- seccion I la recree mas abajo con la definicion correcta. Se resuelven
-- aqui, antes del ALTER. Lo que se cae es muerto por definicion: expone una
-- columna que esta migracion declara muerta.
DO $$
DECLARE
  v_col     text;
  v_oid     oid;
  v_attnum  smallint;
  v_vistas  text;
  v_rondas  int := 0;
BEGIN
  SELECT c.oid INTO v_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'payments';

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_col IN ARRAY ARRAY['recorded_by','transfer_date']
  LOOP
    SELECT a.attnum INTO v_attnum
      FROM pg_attribute a
     WHERE a.attrelid = v_oid
       AND a.attname  = v_col
       AND a.attnum   > 0
       AND NOT a.attisdropped;

    CONTINUE WHEN v_attnum IS NULL;

    LOOP
      v_rondas := v_rondas + 1;
      IF v_rondas > 50 THEN
        RAISE EXCEPTION 'Dependencias circulares al eliminar vistas de public.payments.%', v_col;
      END IF;

      SELECT string_agg(DISTINCT format('%I', c.relname), ', ')
        INTO v_vistas
        FROM pg_depend d
        JOIN pg_rewrite  w ON w.oid = d.objid
        JOIN pg_class    c ON c.oid = w.ev_class
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE d.classid      = 'pg_rewrite'::regclass
         AND d.refclassid   = 'pg_class'::regclass
         AND d.refobjid     = v_oid
         AND d.refobjsubid  = v_attnum
         AND c.relkind      = 'v'
         AND n.nspname      = 'public';

      EXIT WHEN v_vistas IS NULL;

      RAISE NOTICE 'Vistas que dependen de public.payments.%: %', v_col, v_vistas;
      EXECUTE 'DROP VIEW IF EXISTS public.' || v_vistas || ' CASCADE';
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE public.payments DROP COLUMN IF EXISTS recorded_by;
ALTER TABLE public.payments DROP COLUMN IF EXISTS transfer_date;

COMMENT ON TABLE public.payments IS
  'Cobros del estudiante. Estados validos: pending, review, paid, overdue, rejected. '
  'El borrado es logico (deleted_at). Un pago approved solo admite ajuste economico '
  'y solo lo hace el personal (fn_protect_paid_records / fn_protect_payment_financials).';

-- ==========================================================================
-- A2. UN CARGO POR (estudiante, mes, concepto) Y NO POR (estudiante, mes)
-- ==========================================================================
-- BUG ORIGINAL: 02_tablas_pagos_academico_operacion.sql creo
--   UNIQUE (student_id, month_paid) WHERE month_paid IS NOT NULL AND deleted_at IS NULL
-- Un estudiante con mensualidad Y dia prolongado (students.prolongado_fee)
-- genera DOS filas el mismo mes, asi que la segunda caia en ON CONFLICT DO
-- NOTHING y el cargo de dia prolongado NUNCA se creaba. En sentido inverso, la
-- direccion no podia registrar 'Materiales' ni 'Kit' en un mes que ya tenia
-- mensualidad: pg_postgrest devolvia 23505 y js/*/payments.js mostraba
-- "Ya existe un registro para este mes".
--
-- Los datos actuales ya son mas restrictivos que este indice, asi que recrear
-- el indice no puede fallar por duplicados preexistentes.
-- Nota: concept es NULL en los cobros antiguos, y en un indice unico los NULL
-- se consideran distintos entre si, asi que quedan fuera de la garantia.

DROP INDEX IF EXISTS public.idx_payments_unique_student_month;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_student_month_concept
  ON public.payments (student_id, month_paid, concept)
  WHERE month_paid IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON public.payments (student_id, month_paid DESC)
  WHERE month_paid IS NOT NULL AND deleted_at IS NULL;

-- ==========================================================================
-- A3. TRIGGER DE REINSCRIPCION QUE LEIA LA COLUMNA ELIMINADA
-- ==========================================================================
-- BUG ORIGINAL: fn_reenrollment_on_payment_approved() hacia
--   COALESCE(NEW.validated_by, NEW.recorded_by)
-- sobre un trigger de payments. Al eliminar recorded_by, plpgsql no valida el
-- cuerpo al crear la funcion, asi que el error no aparece al aplicar la
-- migracion: aparece la primera vez que se aprueba un pago de 'Reinscripcion',
-- con "record new has no field recorded_by" y la reinscripcion no se aprueba.
-- recorded_by no lo usaba nadie: en el JS/TS no hay una sola referencia y el
-- aprobador real ya esta en validated_by.

CREATE OR REPLACE FUNCTION public.fn_reenrollment_on_payment_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_enr record;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.concept = 'Reinscripción' THEN
    SELECT * INTO v_enr
    FROM public.enrollments
    WHERE payment_id = NEW.id AND status = 'pending'
    LIMIT 1;
    IF FOUND THEN
      PERFORM public.apply_reenrollment_approval(v_enr.id, NEW.validated_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ==========================================================================
-- B. fn_protect_paid_records
-- ==========================================================================
-- BUG ORIGINAL: el trigger es BEFORE UPDATE OR DELETE y terminaba en
--   RETURN NEW;
-- En un DELETE, NEW es NULL, y un trigger BEFORE que devuelve NULL cancela la
-- operacion SILENCIOSAMENTE (no es un error). Resultado: ningun borrado de pago
-- se ejecutaba jamas y la API reportaba exito.
--
-- BUG ORIGINAL 2: al permitir el ajuste de monto de un pago `paid` devolvia la
-- fila COMPLETA, de modo que en el mismo UPDATE el staff podia cambiar tambien
-- status, due_date, validated_by o los discounting.
--
-- Ademas no fijaba search_path y leia public.profiles bajo la RLS del
-- invocante, por lo que v_role podia quedar NULL y el ajuste de staff fallaba.
--
-- Ahora: comparacion por jsonb de la fila completa menos las columnas
-- economicas que si se pueden tocar. Cualquier columna nueva queda protegida
-- por defecto (fail-safe).

CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_ajuste text[] := ARRAY['amount','original_amount','discount_pct',
                           'discount_amount','discount_reason','notes','updated_at'];
BEGIN
  IF OLD.status IS DISTINCT FROM 'paid' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- DELETE: antes devolvia NEW (NULL) y el DELETE se cancelaba en silencio.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'No se puede eliminar un pago ya aprobado (id=%). Usa public.delete_payment() para archivarlo.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT COALESCE(role, '') INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'No se puede modificar un pago ya validado y aprobado (id=%).', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (to_jsonb(NEW) - v_ajuste) IS DISTINCT FROM (to_jsonb(OLD) - v_ajuste) THEN
    RAISE EXCEPTION
      'Sobre un pago aprobado solo se permite ajustar monto y descuento. '
      'Para revertir el estado usa public.reset_payment_to_pending() o public.waive_payment_mora().'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

-- ==========================================================================
-- C. fn_protect_payment_financials
-- ==========================================================================
-- BUG ORIGINAL: la policy payments_parent_can_update_own limitaba el estado
-- final a pending/overdue/review pero NO restringia columnas. Un padre podia
-- hacer UPDATE de su propio pago y en la misma operacion fijar
-- amount = 0, mover due_date o borrar el descuento; el staff lo aprobaba
-- como si fuera legitimo.
--
-- Aqui se comparan las filas menos las columnas que un padre si puede tocar
-- (comprobante, metodo, referencia, nota). El unico cambio de estado permitido
-- es a 'review'; el paso a review por comprobante lo hace ademas
-- fn_on_payment_evidence_uploaded().

CREATE OR REPLACE FUNCTION public.fn_protect_payment_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_tocar text[] := ARRAY['proof_url','evidence_url','notes','method','bank',
                          'reference','updated_at','status'];
BEGIN
  SELECT COALESCE(role, '') INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IN ('directora','asistente','admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_tocar) IS DISTINCT FROM (to_jsonb(OLD) - v_tocar) THEN
    RAISE EXCEPTION
      'Como familia solo puedes adjuntar tu comprobante. El monto, el vencimiento y '
      'el descuento los modifica la direccion.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'review' THEN
    RAISE EXCEPTION
      'No puedes cambiar el estado del pago. Adjunta tu comprobante para que pase a revision.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payment_financials ON public.payments;
CREATE TRIGGER trg_protect_payment_financials
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_payment_financials();

-- ==========================================================================
-- D. get_morosidad_report
-- ==========================================================================
-- BUG ORIGINAL: js/directora/payments_clean.js la invoca en exportMorosidad()
-- pero no existia en ninguna migracion -> error 42883 en runtime y el export
-- CSV de morosidad nunca funciono. Se crea con las columnas que el panel lee.
-- Solo lectura; el filtro por rol se aplica en el WHERE.
-- Su version legada se elimino en la seccion 0.

-- OJO: en LANGUAGE sql los nombres de RETURNS TABLE no existen dentro del
-- cuerpo, la consulta se analiza sola. Toda columna de la lista de SELECT que
-- el ORDER BY nombra tiene que llevar su AS explicito, o el ORDER BY no
-- resuelve (42703) aunque la salida este declarada en el RETURNS TABLE.

CREATE OR REPLACE FUNCTION public.get_morosidad_report(p_month text DEFAULT NULL)
RETURNS TABLE (
  payment_id    bigint,
  student_id    bigint,
  student_name  text,
  classroom     text,
  parent_name   text,
  parent_email  text,
  parent_phone  text,
  month_paid    text,
  concept       text,
  amount        numeric,
  mora          numeric,
  total_due     numeric,
  status        text,
  due_date      date,
  days_overdue  integer
)
-- OJO: en LANGUAGE sql los nombres de RETURNS TABLE no existen dentro del
-- cuerpo, la consulta se analiza sola. Toda columna de la lista de SELECT que
-- el ORDER BY nombra tiene que llevar su AS explicito, o el ORDER BY no
-- resuelve (42703) aunque la salida este declarada en el RETURNS TABLE.
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id                                                                    AS payment_id,
    s.id                                                                    AS student_id,
    btrim(concat_ws(' ', s.name, s.last_name))                              AS student_name,
    c.name                                                                   AS classroom,
    COALESCE(NULLIF(btrim(s.p1_name), ''), NULLIF(btrim(s.p2_name), ''))     AS parent_name,
    COALESCE(NULLIF(btrim(s.p1_email), ''), NULLIF(btrim(s.p2_email), ''))   AS parent_email,
    COALESCE(NULLIF(btrim(s.p1_phone), ''), NULLIF(btrim(s.p2_phone), ''))   AS parent_phone,
    p.month_paid                                                             AS month_paid,
    p.concept                                                                AS concept,
    p.amount                                                                 AS amount,
    public.calculate_mora_v2(p.amount, p.due_date, p.status)                 AS mora,
    p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)      AS total_due,
    p.status                                                                 AS status,
    p.due_date                                                               AS due_date,
    GREATEST(0, (current_date - p.due_date)::int)                            AS days_overdue
  FROM public.payments p
  JOIN public.students s ON s.id = p.student_id
  LEFT JOIN public.classrooms c ON c.id = s.classroom_id
  WHERE p.deleted_at IS NULL
    AND s.deleted_at IS NULL
    AND p.status IN ('pending', 'overdue', 'review')
    AND (p_month IS NULL OR btrim(coalesce(p_month, '')) = '' OR p.month_paid = p_month)
  ORDER BY p.due_date NULLS LAST, student_name;
$$;
REVOKE ALL ON FUNCTION public.get_morosidad_report(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_morosidad_report(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_morosidad_report(text) IS
  'Cobros pendientes/vencidos/en revision con mora calculada. p_month en formato YYYY-MM o NULL para todos.';

-- ==========================================================================
-- E. UNIFICACION DEL VOCABULARIO DE ESTADOS
-- ==========================================================================
-- BUG ORIGINAL: js/shared/payment-service.js escribia status = 'rechazado'
-- (12 ocurrencias en JS, 0 en SQL). El panel de la directora filtra por
-- 'rejected', asi que los rechazos quedaban invisibles y la auditoria los
-- registraba como un 'payment.updated' generico.

UPDATE public.payments SET status = 'rejected' WHERE status = 'rechazado';

DO $$
DECLARE v_otros text;
BEGIN
  SELECT string_agg(DISTINCT status, ', ') INTO v_otros
  FROM public.payments
  WHERE status IS NOT NULL
    AND status NOT IN ('pending','review','paid','overdue','rejected');
  IF v_otros IS NOT NULL THEN
    RAISE EXCEPTION
      'public.payments tiene estados fuera del vocabulario (%). Corregilos antes de crear el CHECK.',
      v_otros;
  END IF;
END $$;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','review','paid','overdue','rejected'));

CREATE INDEX IF NOT EXISTS idx_payments_status_due
  ON public.payments (status, due_date)
  WHERE deleted_at IS NULL AND status IN ('pending','overdue','review');

-- fn_audit_payload debe reconocer ambos nombres por si quedan datos viejos.
CREATE OR REPLACE FUNCTION public.fn_audit_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_action text; v_payload jsonb; v_user_id uuid;
BEGIN
  BEGIN v_user_id := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user_id := NULL; END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'payment.created';
    v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,
      'amount',NEW.amount,'month',NEW.month_paid,'status',NEW.status,
      'method',NEW.method,'concept',NEW.concept);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status
       AND OLD.amount IS NOT DISTINCT FROM NEW.amount
       AND OLD.due_date IS NOT DISTINCT FROM NEW.due_date THEN
      RETURN NEW;
    END IF;
    v_action := CASE
      WHEN NEW.status = 'paid'    AND OLD.status IS DISTINCT FROM 'paid'    THEN 'payment.approved'
      WHEN NEW.status = 'rejected'                                       THEN 'payment.rejected'
      WHEN NEW.status = 'overdue'  AND OLD.status IS DISTINCT FROM 'overdue'  THEN 'payment.overdue'
      WHEN OLD.due_date IS DISTINCT FROM NEW.due_date                    THEN 'payment.due_date_changed'
      ELSE 'payment.updated' END;
    v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,
      'amount',NEW.amount,'month',NEW.month_paid,
      'old_status',OLD.status,'new_status',NEW.status,
      'old_due_date',OLD.due_date,'new_due_date',NEW.due_date);
  ELSE
    v_action := 'payment.deleted';
    v_payload := jsonb_build_object('payment_id',OLD.id,'student_id',OLD.student_id,
      'amount',OLD.amount,'month',OLD.month_paid,'status',OLD.status);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id, v_action, v_payload, now());
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;
CREATE TRIGGER trg_audit_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment();

-- ==========================================================================
-- F. generate_annual_payments y pay_full_year sobre el modelo vigente
-- ==========================================================================
-- Ambas venian del modelo payment_plans (eliminado arriba) y generaban 12
-- filas con status y vencimientos que el ciclo actual ya no produce. Se
-- redirigen a run_payment_cycle() para que no exista una segunda via de cobro.

CREATE OR REPLACE FUNCTION public.generate_annual_payments(p_year int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res jsonb;
BEGIN
  RAISE NOTICE
    'generate_annual_payments esta obsoleto: el ciclo genera un mes a la vez. Se ejecuta run_payment_cycle().';
  v_res := public.run_payment_cycle();
  RETURN v_res || jsonb_build_object('deprecated_alias', 'generate_annual_payments');
END;
$$;
REVOKE ALL ON FUNCTION public.generate_annual_payments(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_annual_payments(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pay_full_year(
  p_student_id bigint,
  p_year       int    DEFAULT NULL,
  p_amount     numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role text; v_id bigint; v_amount numeric;
BEGIN
  SELECT COALESCE(role,'') INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden registrar pagos';
  END IF;

  SELECT monthly_fee INTO v_amount FROM public.students
   WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'El estudiante no existe'; END IF;
  v_amount := COALESCE(p_amount, v_amount);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Monto invalido'; END IF;

  INSERT INTO public.payments
    (student_id, amount, original_amount, concept, status, due_date, month_paid, method, notes, created_at)
  VALUES
    (p_student_id, v_amount, v_amount, 'Pago anual', 'pending', current_date,
     to_char(current_date, 'YYYY') || '-anual', 'efectivo',
     'Registro manual de pago anual', now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.pay_full_year(bigint, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_full_year(bigint, int, numeric) TO authenticated;

-- ==========================================================================
-- G. SIMETRIA DE LA RLS FAMILIAR
-- ==========================================================================
-- BUG ORIGINAL: SELECT y UPDATE usaban is_family_member() (que incluye
-- p2_email, cedula de tutor y sibling_id) pero el INSERT exigia
-- students.parent_id = auth.uid(). Un padre vinculado solo por p2_email podia
-- ver y editar los pagos de su hijo pero NO registrar un comprobante.

DROP POLICY IF EXISTS "payments_parent_can_submit" ON public.payments;
CREATE POLICY "payments_parent_can_submit" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_family_member(student_id)
    AND deleted_at IS NULL
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "payments_parent_can_update_own" ON public.payments;
CREATE POLICY "payments_parent_can_update_own" ON public.payments
  FOR UPDATE TO authenticated
  USING (public.is_family_member(student_id))
  WITH CHECK (public.is_family_member(student_id) AND status IN ('pending','overdue','review'));

-- El personal no debe poder hacer hard DELETE: el borrado es logico.
DROP POLICY IF EXISTS "payments_staff_can_delete" ON public.payments;
CREATE POLICY "payments_staff_can_delete" ON public.payments
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('directora','asistente','admin') AND deleted_at IS NULL);

-- ==========================================================================
-- H. CICLO DE FACTURACION: regla del dia 25 + descuento por hermanos
-- ==========================================================================
-- CONFLICTO RESUELTO: existian dos versiones incompatibles.
--   16_descuentos_y_fix_aprobacion.sql  -> respeta discount_pct, pero genera
--                                          cobros cualquier dia del mes.
--   30_cobro_estudiantes_nuevos_mes_actual.sql -> respeta la regla del dia 25
--                                          ("antes del 25 el padre no ve
--                                          cobros nuevos"), pero.sync_current_
--                                          month_payment perdia el descuento
--                                          personal del estudiante.
-- Ademas 30 inserta el dia prolongado SIN original_amount/discount_*, lo que
-- dejaba la columna original_amount a NULL en la vista de morosidad.
-- La version de abajo es la unica: dia 25 + rank de hermanos + discount_pct +
-- desglose completo en todas las filas.

CREATE OR REPLACE FUNCTION public.get_monthly_fee_for(p_student_id bigint)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee   numeric;
  v_pct   numeric;
  v_extra numeric;
  v_rank  int;
  v_disc  numeric;
BEGIN
  SELECT COALESCE(monthly_fee, 0), COALESCE(discount_pct, 0)
    INTO v_fee, v_pct
  FROM public.students WHERE id = p_student_id;

  IF v_fee <= 0 THEN RETURN 0; END IF;

  v_rank := public.get_student_family_rank(p_student_id);
  v_disc := CASE WHEN v_rank >= 3 THEN 0.15
                 WHEN v_rank = 2  THEN 0.10
                 ELSE 0 END;
  v_disc := GREATEST(v_disc, LEAST(COALESCE(v_pct, 0), 100) / 100);
  v_extra := round((v_fee * v_disc)::numeric, 2);
  RETURN round((v_fee - v_extra)::numeric, 2);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_monthly_fee_for(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_monthly_fee_for(bigint) IS
  'Tarifa mensual neta de un estudiante: monthly_fee menos el mayor descuento entre hermanos (10%/15%) y discount_pct individual.';

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
  v_target_month text;
  v_due_date     date;
  v_last_day     date;
  v_generated    int := 0;
  v_expired      int := 0;
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

  v_target_month := to_char(v_now, 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '1 month')
                     + (v_due_day - 1) * interval '1 day')::date;
  v_last_day     := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

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
      IF FOUND THEN v_generated := v_generated + 1; END IF;

      IF COALESCE(v_student.prolongado_fee, 0) > 0 THEN
        INSERT INTO public.payments
          (student_id, amount, original_amount, discount_pct, discount_amount,
           status, due_date, month_paid, concept, created_at)
        VALUES
          (v_student.id, v_student.prolongado_fee, v_student.prolongado_fee, 0, 0,
           'pending', v_due_date, v_target_month, 'Dia Prolongado', now())
        ON CONFLICT DO NOTHING;
        IF FOUND THEN v_generated := v_generated + 1; END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.payments
     SET status = 'overdue', updated_at = now()
   WHERE status = 'pending'
     AND due_date IS NOT NULL
     AND due_date < v_now
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'generated',     v_generated,
    'expired',       v_expired,
    'month',         v_target_month,
    'due_date',      v_due_date::text,
    'generation_day', v_gen_day,
    'skipped',       CASE WHEN EXTRACT(DAY FROM v_now)::int < v_gen_day
                          THEN 'antes del dia de generacion (' || v_gen_day || ')' END);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_current_month_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gen_day int;
  v_due_day int;
  v_now     date := current_date;
  v_tm      text;
  v_due     date;
  v_last_day date;
  v_amount  numeric;
  v_original numeric;
  v_disc    numeric;
BEGIN
  IF NEW.is_active IS FALSE
     OR COALESCE(NEW.monthly_fee, 0) <= 0
     OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  -- Regla del 25: antes del dia de generacion no se crea ningun cobro.
  -- Antes esta funcion generaba el MES SIGUIENTE en cada actualizacion del
  -- estudiante, y por eso reaparecian meses futuros tras cada limpieza.
  IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
    RETURN NEW;
  END IF;

  v_tm       := to_char(v_now, 'YYYY-MM');
  v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  IF NEW.start_date IS NOT NULL AND NEW.start_date > v_last_day THEN
    RETURN NEW;
  END IF;

  v_due := (date_trunc('month', v_now + interval '1 month')
            + (v_due_day - 1) * interval '1 day')::date;

  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE student_id = NEW.id
      AND concept = 'Mensualidad'
      AND month_paid = v_tm
      AND deleted_at IS NULL
  ) THEN
    v_original := COALESCE(NEW.monthly_fee, 0);
    v_amount   := public.get_monthly_fee_for(NEW.id);
    v_disc     := CASE WHEN v_original > 0
                       THEN round(((v_original - v_amount) / v_original * 100)::numeric, 2)
                       ELSE 0 END;

    INSERT INTO public.payments
      (student_id, amount, original_amount, discount_pct, discount_amount,
       status, due_date, month_paid, concept, created_at)
    VALUES
      (NEW.id, v_amount, v_original, v_disc, round((v_original - v_amount)::numeric, 2),
       'pending', v_due, v_tm, 'Mensualidad', now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_month_payment ON public.students;
CREATE TRIGGER trg_sync_month_payment
  AFTER INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_current_month_payment();

-- ==========================================================================
-- I. v_payments_with_mora recreada
-- ==========================================================================
-- Una vista expande p.* en el momento de crearse, asi que sigueonian
-- exponiendo recorded_by y transfer_date aunque se hayan DROPeado. Por eso se
-- DROPea y se recrea (CREATE OR REPLACE VIEW no puede quitar columnas).

DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calculate_mora_v2(p.amount, p.due_date, p.status)  AS mora_amount,
  public.calculate_mora_v2(p.amount, p.due_date, p.status)  AS calculated_mora,
  p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status) AS total_due,
  GREATEST(0, (current_date - p.due_date)::int)              AS days_late,
  btrim(concat_ws(' ', s.name, s.last_name))                 AS student_name,
  s.p1_name AS parent_name,
  s.p1_email AS parent_email,
  s.p1_phone AS parent_phone,
  s.p2_name AS parent2_name,
  s.p2_email AS parent2_email,
  s.p2_phone AS parent2_phone,
  c.name AS classroom_name,
  ap.name AS approved_by_name
FROM public.payments p
LEFT JOIN public.students  s  ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
LEFT JOIN public.profiles  ap ON ap.id = p.validated_by
WHERE p.deleted_at IS NULL;
GRANT SELECT ON public.v_payments_with_mora TO authenticated, service_role;

-- ==========================================================================
-- J. STORAGE DEL MURO
-- ==========================================================================
-- BUG ORIGINAL: el codigo del muro sube a un bucket 'posts' que no existia en
-- ninguna migracion (se creo a mano en el dashboard, sin limite de tamano ni
-- politicas propias). classroom_media permitia 50 MB, tres veces el limite de
-- producto (propuesta.md seccion 18: 25 MB).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('posts', 'posts', true, 26214400,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif',
              'video/mp4','video/webm','video/quicktime'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 26214400,
      allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif',
                                 'video/mp4','video/webm','video/quicktime'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom_media', 'classroom_media', true, 26214400,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif',
              'video/mp4','video/webm','video/quicktime','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 26214400,
      allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif',
                                 'video/mp4','video/webm','video/quicktime','application/pdf'];

DROP POLICY IF EXISTS "posts_public_read"   ON storage.objects;
CREATE POLICY "posts_public_read"   ON storage.objects FOR SELECT USING (bucket_id = 'posts');

DROP POLICY IF EXISTS "posts_auth_insert"  ON storage.objects;
CREATE POLICY "posts_auth_insert"  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'posts' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "posts_auth_update"  ON storage.objects;
CREATE POLICY "posts_auth_update"  ON storage.objects FOR UPDATE
  USING (bucket_id = 'posts' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "posts_auth_delete"  ON storage.objects;
CREATE POLICY "posts_auth_delete"  ON storage.objects FOR DELETE
  USING (bucket_id = 'posts' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "posts_staff_insert" ON storage.objects;
CREATE POLICY "posts_staff_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'posts'
              AND (public.get_my_role() IN ('directora','admin','asistente','maestra')));

-- ==========================================================================
-- K. DEDUPLICACION REAL DE VISUALIZACIONES DEL MURO
-- ==========================================================================
-- proposal.md seccion 24 pide no contar varias vistas del mismo usuario en la
-- misma sesion. Antes solo se deduplicaba en sessionStorage del navegador, que
-- se borra al cerrar la pestana y se puede falsear desde el cliente.
-- post_views lo hace en el servidor y posts.views_count queda derivado de el.
--
-- digest() se usa para identificar a los visitantes anonimos; pgcrypto se
-- habilita antes de definir la funcion. Se pide explicitamente el esquema
-- extensions (el que usa Supabase) para que el CREATE EXTENSION no deje la
-- funcion en public en un proyecto recien creado.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.post_views (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  viewer_key  text   NOT NULL,
  viewed_on   date   NOT NULL DEFAULT current_date,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (post_id, viewer_key, viewed_on)
);
CREATE INDEX IF NOT EXISTS idx_post_views_post_date ON public.post_views (post_id, viewed_on DESC);

ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_views_read_staff" ON public.post_views;
CREATE POLICY "post_views_read_staff" ON public.post_views
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('directora','asistente','admin','maestra'));

-- El contador de la 08 era un UPDATE ciego: contaba una vista por cada carga y
-- el mismo usuario podia inflar el numero. Este usa public.post_views con clave
-- (post_id, viewer_key, viewed_on) y solo suma si la fila es nueva.
--
-- IMPORTANTE: se cambia el retorno de void a boolean, y CREATE OR REPLACE no
-- permite cambiar el tipo de retorno. Por eso el DROP va explicito.
DROP FUNCTION IF EXISTS public.increment_post_views(bigint) CASCADE;

CREATE FUNCTION public.increment_post_views(p_post_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
-- extensions entra en el search_path porque digest() es de pgcrypto y en
-- Supabase pgcrypto vive en el esquema extensions, no en public. Con
-- search_path = public la funcion se creaba bien pero reventaba en cada
-- llamada con 42883 "function digest(text, unknown) does not exist", que
-- PostgREST reporta como 404. COALESCE no protege: PostgreSQL resuelve y
-- valida los dos argumentos al planificar, no al evaluar, asi que el error
-- saltaba tambien para los visitors con sesion iniciada.
SET search_path = public, extensions
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_key   text;
  v_count int;
BEGIN
  v_key := COALESCE(v_uid::text,
                    'anon:' || left(encode(digest(COALESCE(current_setting('request.headers', true), ''), 'sha256'), 'hex'), 32));

  INSERT INTO public.post_views (post_id, viewer_key, viewed_on)
  VALUES (p_post_id, v_key, current_date)
  ON CONFLICT (post_id, viewer_key, viewed_on) DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.posts
     SET views_count = COALESCE(views_count, 0) + 1
   WHERE id = p_post_id;

  SELECT views_count INTO v_count FROM public.posts WHERE id = p_post_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_post_views(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_post_views(bigint) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.increment_post_views(bigint) IS
  'Registra una visualizacion. Devuelve false si ya estaba contada hoy para ese visor. Requiere pgcrypto (digest).';

-- ==========================================================================
-- L. CRONS SIN PLACEHOLDERS
-- ==========================================================================
-- BUG ORIGINAL: karpus-payment-cycle y karpus-payment-reminders-daily se
-- agendaron con las cadenas literales 'https://TU_REF.supabase.co' y
-- 'Bearer SERVICE_ROLE_KEY'. Tal como estaban, los recordatorios diarios de
-- mora estaban muertos. La URL y la clave se leen de cron_endpoints, que solo
-- es accesible por service_role.

CREATE TABLE IF NOT EXISTS public.cron_endpoints (
  name         text PRIMARY KEY,
  url          text NOT NULL,
  service_key  text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.cron_endpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_endpoints FROM anon, authenticated;

COMMENT ON TABLE public.cron_endpoints IS
  'Destino de los cron jobs de pg_cron. Sin policies: solo service_role. Configurar con el Service Role Key.';

-- pg_cron y pg_net son necesarios para net.http_post. Se comprueba su
-- disponibilidad en lugar de crearlos a ciegas: en un Postgres que no sea
-- Supabase fallaria el CREATE EXTENSION y abortaria toda la transaccion.

DO $$
DECLARE v_cron_ok boolean; v_net_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') INTO v_cron_ok;
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_net')  INTO v_net_ok;

  IF NOT v_cron_ok THEN
    RAISE NOTICE 'pg_cron no disponible. Activar en Dashboard > Database > Extensions.';
  END IF;
  IF v_net_ok AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $$;

DO $$
DECLARE
  e        record;
  v_cron   text;
  v_url    text;
  v_key    text;
  v_active int;
  v_cron_ok boolean;
  v_net_ok  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') INTO v_cron_ok;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net')  INTO v_net_ok;
  IF NOT v_cron_ok THEN
    RAISE NOTICE
      'pg_cron no instalado. Activar en Dashboard > Database > Extensions. '
      'Ciclo y recordatorios se pueden correr a mano con run_payment_cycle() y payment-reminders.';
    RETURN;
  END IF;

  FOR v_cron IN
    SELECT unnest(ARRAY['karpus-mark-overdue','karpus-payment-cycle',
                        'karpus-payment-reminders-daily','karpus-cleanup-logs'])
  LOOP
    BEGIN PERFORM cron.unschedule(v_cron); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  SELECT count(*) FILTER (WHERE is_active), min(url), min(service_key)
    INTO v_active, v_url, v_key
  FROM public.cron_endpoints
  WHERE name = 'default';

  -- Sin configurar, se limpian igual los crons rotos y se avisa.
  IF v_active IS NULL OR v_active = 0 THEN
    RAISE NOTICE
      'Crons NO agendados: falta un registro en public.cron_endpoints (name=default, url, service_key, is_active=true). '
      'Ciclo y recordatorios se pueden correr a mano con run_payment_cycle() y payment-reminders.';
    RETURN;
  END IF;

  -- El vencimiento y la limpieza son SQL puro: no dependen de pg_net.
  PERFORM cron.schedule('karpus-mark-overdue', '0 10 * * *',
    $c$UPDATE public.payments SET status='overdue', updated_at=now()
        WHERE status='pending' AND due_date < current_date AND deleted_at IS NULL;$c$);

  PERFORM cron.schedule('karpus-cleanup-logs', '0 3 1 * *',
    $c$DELETE FROM public.login_attempts WHERE created_at < now() - interval '30 days';
       DELETE FROM public.system_errors  WHERE created_at < now() - interval '90 days';$c$);

  -- El ciclo y los recordatorios llaman a las Edge Functions por HTTP.
  IF NOT v_net_ok THEN
    RAISE NOTICE
      'pg_net no instalado: karpus-payment-cycle y karpus-payment-reminders-daily NO agendados. '
      'Activar pg_net y volver a ejecutar esta migracion.';
    RETURN;
  END IF;

  -- Diario y sin force: la propia funcion respeta el dia de generacion (25).
  PERFORM cron.schedule('karpus-payment-cycle', '10 10 * * *',
    format($c$SELECT net.http_post(url:='%s',headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{}'::jsonb);$c$,
           v_url || '/functions/v1/auto-payment-cycle', v_key));

  PERFORM cron.schedule('karpus-payment-reminders-daily', '0 13 * * *',
    format($c$SELECT net.http_post(url:='%s',headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{"action":"auto"}'::jsonb);$c$,
           v_url || '/functions/v1/payment-reminders', v_key));

  RAISE NOTICE 'Crons agendados desde public.cron_endpoints.';
END $$;

-- ==========================================================================
-- N. PERIODO ESCOLAR 2026-2027: PISO DE COBROS Y LIQUIDACION DE DEUDA PREVIA
-- ==========================================================================
-- El ano escolar vigente arranca en AGOSTO 2026 (2026-08-01). Todo lo anterior
-- (mayo, junio, julio y meses de anos previos) queda FUERA del sistema:
--   - no se genera,
--   - no se vence (no genera mora ni "deuda"),
--   - no se admite por el indice unico.
-- Se implementa un piso unico, public.school_year_floor_month(), derivado del
-- start_date del ano escolar activo. Las funciones de cobro lo consultan.
--
-- Deuda existente: los pagos PENDIENTES/OVERDUE/REVIEW de meses anteriores al
-- piso se neutralizan (soft-delete en payments, 'waived' en student_charges).
-- Los ya PAGADOS NO se tocan: son dinero recibido y deben conservarse.

-- ---- N.1 Funcion canonica del piso -----------------------------------------
CREATE OR REPLACE FUNCTION public.school_year_floor_month()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
BEGIN
  -- BUG: se ordenaba por status primero, de modo que un 2025-2026 que siguiera
  -- en 'active' ganaba al 2026-2027 recien insertado y el piso caia a 2025-08,
  -- dejando pasar los cobros de mayo/junio/julio 2026. Ahora manda la fecha mas
  -- reciente y el status solo desempatena.
  SELECT start_date INTO v_start
  FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY start_date DESC,
           CASE status WHEN 'active' THEN 1 WHEN 'enrollment' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_start IS NULL THEN
    SELECT start_date INTO v_start
    FROM public.school_years
    WHERE start_date <= current_date
    ORDER BY start_date DESC
    LIMIT 1;
  END IF;

  IF v_start IS NULL THEN
    v_start := DATE '2026-08-01';   -- fallback del periodo 2026-2027
  END IF;

  RETURN to_char(v_start, 'YYYY-MM');
END;
$$;
REVOKE ALL ON FUNCTION public.school_year_floor_month() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_year_floor_month() TO authenticated, service_role;

-- ---- N.2 Asegurar el ano escolar 2026-2027 --------------------------------
DO $$
DECLARE
  v_exists    boolean;
  v_archived  int := 0;
BEGIN
  -- 1) Archivar los anos escolares anteriores. Sin esto, un 2025-2026 que
  --    siguiera 'active' coexistia con el 2026-2027 y las vistas que filtran
  --    por status='active' (absent-service.js, reinscripcion.js) leian una fila
  --    arbitraria.
  UPDATE public.school_years
     SET status = 'archived'
   WHERE end_date < DATE '2026-08-01'
     AND status IN ('active','enrollment','reenrollment');

  GET DIAGNOSTICS v_archived = ROW_COUNT;
  IF v_archived > 0 THEN
    RAISE NOTICE 'Anos escolares previos archivados: %', v_archived;
  END IF;

  -- 2) Asegurar el 2026-2027.
  SELECT EXISTS (
    SELECT 1 FROM public.school_years
    WHERE start_date >= DATE '2026-08-01'
      AND start_date <  DATE '2026-09-01'
  ) INTO v_exists;

  IF NOT v_exists THEN
    INSERT INTO public.school_years (name, start_date, end_date, status)
    VALUES ('2026-2027', DATE '2026-08-01', DATE '2027-06-30', 'active');
    RAISE NOTICE 'Ano escolar 2026-2027 creado (piso de cobros = 2026-08).';
  ELSE
    UPDATE public.school_years
       SET status = 'active',
           end_date = DATE '2027-06-30'
     WHERE start_date >= DATE '2026-08-01'
       AND start_date <  DATE '2026-09-01';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'No se pudo asegurar el ano escolar 2026-2027: %', SQLERRM;
END $$;

-- ---- N.3 Liquidacion de la deuda anterior al piso -------------------------
-- Se hace ANTES de crear la restriccion N.4 para que el UPDATE no choque con
-- ella. Los pagos YA PAGADOS de meses previos NO se tocan: son dinero recibido
-- y deben conservarse como historial.
DO $$
DECLARE
  v_floor        text;
  v_pay_voided   int := 0;
  v_pay_kept     int := 0;
  v_charg_waived int := 0;
  v_sum          numeric;
BEGIN
  v_floor := public.school_year_floor_month();

  -- (a) Pagos por debajo del piso y NO pagados -> son la "deuda": se anulan
  --     logicamente (deleted_at). Quedan fuera de RLS, vistas y totales.
  WITH cleared AS (
    UPDATE public.payments
       SET deleted_at = COALESCE(deleted_at, now())
     WHERE month_paid IS NOT NULL
       AND month_paid <  v_floor
       AND status IN ('pending','overdue','review','rejected')
       AND deleted_at IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_pay_voided FROM cleared;

  -- (b) Pagos por debajo del piso pero YA PAGADOS: se conservan.
  SELECT count(*) INTO v_pay_kept
  FROM public.payments
  WHERE month_paid IS NOT NULL
    AND month_paid <  v_floor
    AND status = 'paid'
    AND deleted_at IS NULL;

  -- (c) student_charges no tiene deleted_at; su estado terminal permitido por su
  --     CHECK es 'waived' (condonado). Para meses previos es lo correcto.
  WITH w AS (
    UPDATE public.student_charges
       SET status = 'waived'
     WHERE month_paid IS NOT NULL
       AND month_paid <  v_floor
       AND status IN ('pending','review')
    RETURNING id
  )
  SELECT count(*) INTO v_charg_waived FROM w;

  IF (v_pay_voided + v_charg_waived) > 0 THEN
    SELECT COALESCE(sum(amount),0) INTO v_sum
    FROM public.payments
    WHERE month_paid IS NOT NULL AND month_paid < v_floor
      AND status IN ('pending','overdue','review','rejected')
      AND deleted_at IS NULL;

    INSERT INTO public.audit_logs (user_id, action, payload)
    VALUES (NULL, 'payment.pre_floor_cleared', jsonb_build_object(
      'floor_month',     v_floor,
      'payments_voided', v_pay_voided,
      'charges_waived',  v_charg_waived,
      'paid_kept',       v_pay_kept,
      'amount_voided',   v_sum,
      'reason',          'Cierre del periodo 2026-2027: sin cobros ni deuda anteriores a agosto 2026'
    ));
  END IF;

  RAISE NOTICE
    'Periodo %: anulados % pagos previos, % cargos condonados, % pagos pagados conservados.',
    v_floor, v_pay_voided, v_charg_waived, v_pay_kept;
END $$;

-- ---- N.4 Restriccion dura: ningun cobro nuevo antes de agosto 2026 --------
-- Literal, no funcion: un CHECK debe ser determinista. El piso dinamico lo
-- respeta public.school_year_floor_month() en la logica; esta restriccion es
-- la red de seguridad final.
--
-- Se crea NOT VALID a proposito: los pagos YA PAGADOS de meses anteriores se
-- conservan como historial y no deben bloquear la aplicacion. La restriccion
-- si aplica a toda fila nueva o actualizada.
--
-- AL ROLAR EL AÑO ESCOLAR: cambiar '2026-08' por el nuevo mes de inicio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_month_floor_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_month_floor_check
      CHECK (month_paid IS NULL OR month_paid >= '2026-08') NOT VALID;
    RAISE NOTICE 'Restriccion payments_month_floor_check activa (piso 2026-08).';
  END IF;
END $$;

-- ---- N.5 run_payment_cycle: respeta el piso -------------------------------
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
      IF FOUND THEN v_generated := v_generated + 1; END IF;

      IF COALESCE(v_student.prolongado_fee, 0) > 0 THEN
        INSERT INTO public.payments
          (student_id, amount, original_amount, discount_pct, discount_amount,
           status, due_date, month_paid, concept, created_at)
        VALUES
          (v_student.id, v_student.prolongado_fee, v_student.prolongado_fee, 0, 0,
           'pending', v_due_date, v_target_month, 'Dia Prolongado', now())
        ON CONFLICT DO NOTHING;
        IF FOUND THEN v_generated := v_generated + 1; END IF;
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

-- ---- N.6 mark_overdue_payments: no vencido antes del piso ------------------
CREATE OR REPLACE FUNCTION public.mark_overdue_payments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_floor text;
BEGIN
  v_floor := public.school_year_floor_month();

  UPDATE public.payments
  SET status = 'overdue'
  WHERE status = 'pending'
    AND deleted_at IS NULL
    AND due_date < CURRENT_DATE
    AND (month_paid IS NULL OR month_paid >= v_floor);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('expired', v_count, 'floor_month', v_floor);
END;
$$;

-- ---- N.7 sync_current_month_payment: respeta el piso -----------------------
CREATE OR REPLACE FUNCTION public.sync_current_month_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gen_day int;
  v_due_day int;
  v_now     date := current_date;
  v_tm      text;
  v_floor   text;
  v_due     date;
  v_last_day date;
  v_amount  numeric;
  v_original numeric;
  v_disc    numeric;
BEGIN
  IF NEW.is_active IS FALSE
     OR COALESCE(NEW.monthly_fee, 0) <= 0
     OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_tm    := to_char(v_now, 'YYYY-MM');
  v_floor := public.school_year_floor_month();

  -- Blindaje: nada antes del inicio del ano escolar.
  IF v_tm < v_floor THEN
    RETURN NEW;
  END IF;

  -- Regla del 25: antes del dia de generacion no se crea ningun cobro.
  IF EXTRACT(DAY FROM v_now)::int < v_gen_day THEN
    RETURN NEW;
  END IF;

  v_last_day := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;

  IF NEW.start_date IS NOT NULL AND NEW.start_date > v_last_day THEN
    RETURN NEW;
  END IF;

  v_due := (date_trunc('month', v_now + interval '1 month')
            + (v_due_day - 1) * interval '1 day')::date;

  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE student_id = NEW.id
      AND concept = 'Mensualidad'
      AND month_paid = v_tm
      AND deleted_at IS NULL
  ) THEN
    v_original := COALESCE(NEW.monthly_fee, 0);
    v_amount   := public.get_monthly_fee_for(NEW.id);
    v_disc     := CASE WHEN v_original > 0
                       THEN round(((v_original - v_amount) / v_original * 100)::numeric, 2)
                       ELSE 0 END;

    INSERT INTO public.payments
      (student_id, amount, original_amount, discount_pct, discount_amount,
       status, due_date, month_paid, concept, created_at)
    VALUES
      (NEW.id, v_amount, v_original, v_disc, round((v_original - v_amount)::numeric, 2),
       'pending', v_due, v_tm, 'Mensualidad', now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ---- N.8 generate_student_charges: el mes de inicio no puede ser pasado ---
-- Reemplaza la version de la migracion 08. IMPORTANTE: se conserva EXACTA la
-- firma original (bigint y el mismo orden de parametros) porque el panel la
-- invoca por nombre en js/shared/student-record-modal.js. Cambiarla crearia una
-- sobrecarga y dejaria viva la version sin piso.
CREATE OR REPLACE FUNCTION public.generate_student_charges(
  p_student_id          bigint,
  p_plan                text    DEFAULT 'mensual',
  p_inscription_amount  numeric DEFAULT 0,
  p_monthly_amount      numeric DEFAULT 0,
  p_prolongado_fee      numeric DEFAULT 0,
  p_discount_pct        numeric DEFAULT 0,
  p_due_day             int     DEFAULT 5,
  p_months              int     DEFAULT 10,
  p_start_month         text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        text;
  v_charges     int := 0;
  v_payments    int := 0;
  v_start_month text;
  v_curr        date    := current_date;
  v_discount    numeric;
  v_month_net   numeric;
  v_prolong_net numeric;
  v_gen_day     int;
  v_due_day     int;
  v_start_date  date;
  v_first_due   date;
  v_month       text;
  v_due         date;
  v_floor       text;
BEGIN
  SELECT COALESCE(role,'') INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden generar cargos';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'El estudiante no existe';
  END IF;

  SELECT COALESCE(generation_day, 25), COALESCE(due_day, 5)
    INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_floor := public.school_year_floor_month();

  -- BUG ORIGINAL: v_start_month se tomaba tal cual. Si el panel enviaba
  -- '2026-05' (mes anterior al periodo) se creaba un cargo de mayo, la UI lo
  -- mostraba como deuda y el indice unico no lo frenaba.
  v_start_month := COALESCE(p_start_month, to_char(v_curr, 'YYYY-MM'));
  IF v_start_month < v_floor THEN
    v_start_month := v_floor;
  END IF;

  v_discount    := GREATEST(0, LEAST(COALESCE(p_discount_pct, 0), 100));
  v_month_net   := round(COALESCE(p_monthly_amount, 0) * (1 - v_discount / 100), 2);
  v_prolong_net := round(COALESCE(p_prolongado_fee, 0) * (1 - v_discount / 100), 2);

  v_start_date := to_date(v_start_month || '-01', 'YYYY-MM-DD');
  v_first_due  := (v_start_date + (v_gen_day - 1) * interval '1 day')::date;
  IF v_first_due < v_curr THEN v_first_due := v_curr; END IF;

  -- Solo 'mensual' dentro del periodo: 'anual' y 'doble' adelantan el ano
  -- completo y usan month_paid distinto del ciclo mensual.
  IF p_plan <> 'mensual' THEN
    RAISE EXCEPTION
      'Plan % no disponible en el periodo %: solo se permite mensual.',
      p_plan, v_floor;
  END IF;

  IF COALESCE(p_inscription_amount, 0) > 0 THEN
    v_due := v_first_due;
    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
    VALUES (p_student_id, 'Inscripción', 'inscripcion',
            COALESCE(p_inscription_amount, 0), v_discount,
            round(COALESCE(p_inscription_amount, 0) * (1 - v_discount / 100), 2),
            v_start_month, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, month_paid, created_at)
    VALUES (p_student_id, round(COALESCE(p_inscription_amount, 0) * (1 - v_discount / 100), 2),
            'Inscripción', 'pending', v_due, v_start_month, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;
  END IF;

  -- Plan mensual: SOLO el mes actual, y solo tras el dia de generacion.
  IF EXTRACT(DAY FROM v_curr)::int >= v_gen_day
     AND to_char(v_curr, 'YYYY-MM') >= v_start_month
     AND to_char(v_curr, 'YYYY-MM') >= v_floor
  THEN
    v_month := to_char(v_curr, 'YYYY-MM');

    IF v_month = v_start_month THEN
      v_due := v_first_due;
    ELSE
      v_due := (to_date(v_month || '-01', 'YYYY-MM-DD')
                + (v_due_day - 1) * interval '1 day')::date;
    END IF;

    IF v_due < v_curr THEN v_due := v_curr; END IF;

    INSERT INTO public.student_charges
      (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
    VALUES (p_student_id, 'Mensualidad', 'mensualidad',
            COALESCE(p_monthly_amount, 0), v_discount, v_month_net,
            v_month, v_due, 'pending', auth.uid())
    ON CONFLICT DO NOTHING;

    INSERT INTO public.payments
      (student_id, amount, concept, status, due_date, month_paid, created_at)
    VALUES (p_student_id, v_month_net, 'Mensualidad', 'pending', v_due, v_month, now())
    ON CONFLICT DO NOTHING;

    v_charges  := v_charges + 1;
    v_payments := v_payments + 1;

    IF v_prolong_net > 0 THEN
      INSERT INTO public.student_charges
        (student_id, concept, type, amount, discount_pct, amount_net, month_paid, due_date, status, created_by)
      VALUES (p_student_id, 'Día Prolongado', 'prolongado',
              COALESCE(p_prolongado_fee, 0), v_discount, v_prolong_net,
              v_month, v_due, 'pending', auth.uid())
      ON CONFLICT DO NOTHING;

      INSERT INTO public.payments
        (student_id, amount, concept, status, due_date, month_paid, created_at)
      VALUES (p_student_id, v_prolong_net, 'Día Prolongado', 'pending', v_due, v_month, now())
      ON CONFLICT DO NOTHING;

      v_charges  := v_charges + 1;
      v_payments := v_payments + 1;
    END IF;
  END IF;

  UPDATE public.students
     SET monthly_fee    = COALESCE(p_monthly_amount, monthly_fee),
         prolongado_fee = COALESCE(p_prolongado_fee, prolongado_fee),
         due_day        = COALESCE(p_due_day,         due_day),
         discount_pct   = v_discount,
         payment_plan   = p_plan
   WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'charges', v_charges, 'payments', v_payments, 'plan', p_plan,
    'start_month', v_start_month, 'first_due', v_first_due::text,
    'floor_month', v_floor);
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_student_charges(
  bigint, text, numeric, numeric, numeric, numeric, int, int, text
) TO authenticated, service_role;

-- ---- N.9 financial_summary_month: vocabulario sin estados inventados ------
-- La version de la 08 filtraba por 'pagado','confirmado','pendiente','vencido',
-- valores que el CHECK de la 10 prohibe. Se conserva la firma (int, int).
CREATE OR REPLACE FUNCTION public.financial_summary_month(p_year int, p_month int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_key text;
  v_floor    text;
  v_paid     numeric := 0;
  v_pending  numeric := 0;
  v_paid_n   int := 0;
  v_pend_n   int := 0;
  v_in_scope boolean;
BEGIN
  v_month_key := p_year || '-' || lpad(p_month::text, 2, '0');
  v_floor     := public.school_year_floor_month();
  v_in_scope  := v_month_key >= v_floor;

  IF v_in_scope THEN
    SELECT COALESCE(sum(amount),0), count(*)
      INTO v_paid, v_paid_n
    FROM public.payments
    WHERE month_paid = v_month_key AND status = 'paid' AND deleted_at IS NULL;

    SELECT COALESCE(sum(amount),0), count(*)
      INTO v_pending, v_pend_n
    FROM public.payments
    WHERE month_paid = v_month_key
      AND status IN ('pending','review','overdue')
      AND deleted_at IS NULL;
  END IF;

  -- Meses fuera del periodo devuelven ceros, no la deuda de mayo/junio/julio.
  RETURN jsonb_build_object(
    'month',         v_month_key,
    'year',          p_year,
    'paid',          v_paid,   'paid_count',    v_paid_n,
    'pending',       v_pending,'pending_count', v_pend_n,
    'in_period',     v_in_scope,
    'floor_month',   v_floor);
END;
$$;
GRANT EXECUTE ON FUNCTION public.financial_summary_month(int, int) TO authenticated, service_role;

-- ---- N.10 Indice de apoyo para el piso ------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_month_floor
ON public.payments (month_paid)
WHERE month_paid IS NOT NULL AND deleted_at IS NULL;

-- ==========================================================================
-- M. VERIFICACION
-- ==========================================================================
DO $$
DECLARE v_col text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_col
  FROM unnest(ARRAY['recorded_by','transfer_date']) c
  WHERE c IN (
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payments');

  IF v_col IS NOT NULL THEN
    RAISE EXCEPTION 'persisten columnas muertas en payments: %', v_col;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE status = 'rechazado') THEN
    RAISE EXCEPTION 'quedan pagos con status=rechazado';
  END IF;

  -- Periodo 2026-2027: no debe quedar deuda viva anterior a agosto 2026.
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE month_paid IS NOT NULL
      AND month_paid < '2026-08'
      AND status IN ('pending','overdue','review')
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'quedan pagos pendientes/vencidos anteriores a 2026-08 (deuda fuera del periodo)';
  END IF;

  RAISE NOTICE
    'Migracion 10 aplicada: tablas muertas eliminadas, trigger de borrado corregido, '
    'importes protegidos, get_morosidad_report disponible, crons leidos de cron_endpoints. '
    'Periodo de cobros: % en adelante.', public.school_year_floor_month();
END $$;

COMMIT;
