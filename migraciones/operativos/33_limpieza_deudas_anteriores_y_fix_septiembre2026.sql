-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 33 — LIMPIEZA DE DEUDAS VENCIDAS ANTERIORES Y FIX SEPTIEMBRE 2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Descripción:
--   1. Limpia registros antiguos en estado 'pending' u 'overdue' anteriores a Septiembre 2026.
--   2. Maneja adecuadamente tanto formatos YYYY-MM como nombres de mes ('Agosto', 'Julio', etc.).
--   3. Provee función RPC de reconciliación para evitar falsas deudas en ciclos posteriores.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Soft delete de deudas vencidas/pendientes de meses anteriores a Septiembre 2026
UPDATE public.payments
SET deleted_at = now(),
    notes = COALESCE(notes, '') || ' | Limpieza automatica: deudas pasadas saldadas'
WHERE status IN ('pending', 'overdue')
  AND deleted_at IS NULL
  AND (
    (month_paid ~ '^\d{4}-\d{2}$' AND month_paid < '2026-09')
    OR month_paid ILIKE '%agosto%'
    OR month_paid ILIKE '%julio%'
    OR month_paid ILIKE '%junio%'
    OR (due_date IS NOT NULL AND due_date < '2026-09-01')
  );

-- 2. Función RPC para reconciliar deudas pasadas y ciclo de facturación
CREATE OR REPLACE FUNCTION public.reconcile_past_debts_and_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cleared_count int := 0;
BEGIN
  -- Cancelar cobros pendientes/vencidos huérfanos de meses previos
  UPDATE public.payments p
  SET deleted_at = now(),
      notes = COALESCE(p.notes, '') || ' | Reconciliacion automatica de periodo'
  FROM public.students s
  WHERE p.student_id = s.id
    AND p.status IN ('pending', 'overdue')
    AND p.deleted_at IS NULL
    AND (
      (s.start_date IS NOT NULL AND p.due_date < s.start_date)
      OR (p.month_paid ~ '^\d{4}-\d{2}$' AND p.month_paid < '2026-09')
      OR p.month_paid ILIKE '%agosto%'
      OR p.month_paid ILIKE '%julio%'
      OR (p.due_date IS NOT NULL AND p.due_date < '2026-09-01')
    );

  GET DIAGNOSTICS v_cleared_count = ROW_COUNT;
  RETURN jsonb_build_object('cleared_past_debts', v_cleared_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_past_debts_and_cycle() TO authenticated;
