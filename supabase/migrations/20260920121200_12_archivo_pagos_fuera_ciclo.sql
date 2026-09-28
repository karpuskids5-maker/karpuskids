-- ==========================================================================
-- KARPUS KIDS / MIGRACION CONSOLIDADA 12/11 - ARCHIVO DE PAGOS Y ANULACION
-- DE COBROS FUERA DE CICLO
--
-- Corrige un callejon sin salida: un pago `paid` NO podia archivarse nunca.
--
-- Que pasaba
-- ----------
-- 1) `trg_protect_paid_records` (fn_protect_paid_records, migracion 10) solo
--    permite tocar, sobre un pago aprobado, las columnas economicas:
--        amount, original_amount, discount_pct, discount_amount,
--        discount_reason, notes, updated_at
--    `deleted_at` NO estaba en la lista, asi que archivar un pago aprobado
--    disparaba el error:
--        "Sobre un pago aprobado solo se permite ajustar monto y descuento.
--         Para revertir el estado usa public.reset_payment_to_pending() o
--         public.waive_payment_mora()."
--
-- 2) Pero esas dos funciones que recomienda el propio error TAMBIEN escriben
--    columnas bloqueadas (status, due_date, last_reminder_sent), por lo que
--    fallan con el mismo error. Y `public.delete_payment()` (la funcion que si
--    escribe `deleted_at` + `notes`) tambien es bloqueada por el trigger.
--    Resultado: un pago aprobado era inmutable de facto, sin ninguna via
--    soportada para archivarlo. El mensaje de error apuntaba a un camino
--    cerrado.
--
-- 3) Encima, `payments_month_floor_check`
--        CHECK (month_paid IS NULL OR month_paid >= '2026-08') NOT VALID
--    revalida en cada UPDATE. Al ser `NOT VALID` grandfathera las filas
--    historicas (`month_paid = '2026-05'`), pero eso tambien hacia que
--    CUALQUIER update de esas filas -incluido un simple `deleted_at`-
--    rebotara con 23514 check_violation.
--
-- Que hace esta migracion
-- ----------------------
-- A. Agrega `deleted_at` a las columnas de ajuste de `fn_protect_paid_records`:
--    archivar (soft delete) un pago aprobado vuelve a estar permitido, que es
--    justo lo que hace `public.delete_payment()`. El monto, el estado, la
--    fecha de pago y `validated_by` siguen protegidos, y el control de rol
--    (directora/asistente/admin) se mantiene igual.
--
-- B. Relaja `payments_month_floor_check` para que el piso admita las filas ya
--    archivadas:
--        CHECK (month_paid IS NULL OR month_paid >= '2026-08'
--               OR deleted_at IS NOT NULL) NOT VALID
--    Un pago de un ciclo anterior se puede archivar, pero NO se puede volver a
--    fecha, reasignar de mes ni reactivar. Se mantiene `NOT VALID` para no
--    escanear la tabla.
--
-- C. DATO: anula el lote de 18 cobros de `2026-05` (RD$ 93,603.00, ids
--    245-262) que se genero y aprobo por error el 2026-09-23/25 desde el panel
--    de directora. Pertenecen al ciclo anterior (el vigente es 2026-08 ->
--    2027-07) y se approve fuera de ciclo, igual que los cargos adelantados
--    2026-10 -> 2027-06 que ya estaban anulados.
--
-- IDEMPOTENTE: se puede aplicar sobre la base ya desplegada. El UPDATE de (C)
-- solo toca `month_paid = '2026-05'` con `deleted_at IS NULL`; si ya se aplico,
-- no hace nada. A y B son CREATE OR REPLACE / DROP+ADD.
--
-- APLICAR: `supabase db push`, o pegar el contenido en el SQL Editor de
-- Supabase (el SQL Editor corre como dueno de la tabla, necesario para el
-- DISABLE/ENABLE TRIGGER de (C) y el DROP/ADD CONSTRAINT de (B)).
-- ==========================================================================


-- ==========================================================================
-- A. fn_protect_paid_records: permitir el archivado (deleted_at)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  -- 'deleted_at' agregado: archivar un pago aprobado es la via soportada
  -- (public.delete_payment()). Monto, estado, paid_date, validated_by y demas
  -- siguen protegidos, y el control de rol se mantiene igual.
  v_ajuste text[] := ARRAY['amount','original_amount','discount_pct',
                           'discount_amount','discount_reason','notes','updated_at',
                           'deleted_at'];
BEGIN
  IF OLD.status IS DISTINCT FROM 'paid' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- DELETE: sigue sin permitirse; el borrado logico es la via soportada.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'No se puede eliminar un pago ya aprobado (id=%). Usa public.delete_payment() para archivarlo.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- OJO: la asignacion con COALESCE no cubre el caso sin fila (auth.uid() NULL
  -- deja la variable en NULL, y `NULL NOT IN (...)` es NULL, no TRUE), asi que
  -- el chequeo de rol sigue siendo permisivo con la service key. Se deja tal
  -- cual para no cambiar comportamiento en esta migracion; queda como
  -- pendiente: usar `IF v_role IS NULL OR v_role NOT IN (...)`.
  SELECT COALESCE(role, '') INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'No se puede modificar un pago ya validado y aprobado (id=%).', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (to_jsonb(NEW) - v_ajuste) IS DISTINCT FROM (to_jsonb(OLD) - v_ajuste) THEN
    RAISE EXCEPTION
      'Sobre un pago aprobado solo se permite ajustar monto, descuento o archivar (deleted_at). '
      'Para revertir el estado usa public.reset_payment_to_pending() o public.waive_payment_mora().'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- El trigger no cambia, pero se asegura de que exista con la funcion nueva.
DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();


-- ==========================================================================
-- B. payments_month_floor_check: el piso admite lo ya archivado
-- ==========================================================================
-- Sin manejador de EXCEPTION a proposito: si el DROP o el ADD fallan, la
-- migracion aborta y revierte, en vez de dejar la tabla sin el piso.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_month_floor_check'
  ) THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_month_floor_check;
  END IF;

  ALTER TABLE public.payments
    ADD CONSTRAINT payments_month_floor_check
    CHECK (month_paid IS NULL OR month_paid >= '2026-08' OR deleted_at IS NOT NULL) NOT VALID;

  RAISE NOTICE 'payments_month_floor_check reactivada: piso 2026-08, las filas archivadas quedan fuera del piso.';
END $$;


-- ==========================================================================
-- C. DATO: anular el lote de cobros de mayo 2026 (ciclo anterior)
-- ==========================================================================
DO $$
DECLARE
  v_ids   bigint[];
  v_total numeric(10,2);
  v_n     integer;
BEGIN
  SELECT array_agg(id ORDER BY id), count(*), sum(amount)
    INTO v_ids, v_n, v_total
    FROM public.payments
   WHERE month_paid = '2026-05'
     AND deleted_at IS NULL;

  IF v_n IS NULL OR v_n = 0 THEN
    RAISE NOTICE 'No hay cobros de 2026-05 sin anular: nada que hacer.';
    RETURN;
  END IF;

  -- El UPDATE lo hace el dueno de la tabla (contexto de migracion, sin
  -- auth.uid()), y trg_protect_paid_records exige un rol de staff. Como el
  -- archivo de pagos APROBADOS es precisamente la intencion de esta
  -- migracion, el trigger se desactiva solo durante el UPDATE y se vuelve a
  -- activar siempre. Es transaccional: si algo falla, el estado del trigger
  -- tambien revierte.
  EXECUTE 'ALTER TABLE public.payments DISABLE TRIGGER trg_protect_paid_records';

  UPDATE public.payments
     SET deleted_at = now(),
         updated_at = now(),
         notes = COALESCE(notes || ' | ', '')
                 || 'Anulado: cobro de mayo 2026 (ciclo anterior al vigente 2026-08 -> 2027-07), '
                 || 'generado y aprobado por error el 23/09/2026 desde el panel de directora ('
                 || to_char(now(), 'DD/MM/YYYY HH24:MI') || ')'
   WHERE month_paid = '2026-05'
     AND deleted_at IS NULL;

  EXECUTE 'ALTER TABLE public.payments ENABLE TRIGGER trg_protect_paid_records';

  RAISE NOTICE 'Anulados % cobros de 2026-05 (RD$ %) ids: %', v_n, v_total, v_ids;
EXCEPTION
  WHEN others THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.payments ENABLE TRIGGER trg_protect_paid_records';
    EXCEPTION WHEN others THEN
      NULL;  -- se reporta abajo
    END;
    RAISE WARNING 'No se pudieron anular los cobros de 2026-05: %', SQLERRM;
END $$;
