-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 23 — AUSENCIAS AUTOMÁTICAS 24/7
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivo:
--   Garantizar que la detección de ausentes (`mark_absent_students`) corra de
--   forma AUTOMÁTICA e independiente de que alguien abra el panel de la maestra.
--   Se programa con pg_cron cada 15 minutos en horario laboral (7:00–19:00 RD).
--
--   Reglas ya cubiertas por `mark_absent_students`:
--     1. Solo aplica en días laborables (school_settings.work_days).
--     2. Solo una vez pasada la hora de entrada (check_in_end) + 2 horas.
--     3. NO sobrescribe estados finales: present / late / retirado / absent.
--     4. Idempotente y a prueba de reintentos.
--
--   EJECUTAR DESDE: Dashboard → SQL Editor (requiere pg_cron habilitado:
--   Database → Extensions → buscar "pg_cron" → Enable)
-- ═══════════════════════════════════════════════════════════════════════════
-- 2) get_dashboard_kpis — añade conteo de ausentes de hoy (para el KPI rojo)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_students   int;
  v_teachers   int;
  v_classrooms int;
  v_attendance int;
  v_absent     int;
  v_pending    numeric;
  v_review_count int;
  v_incidents  int;
  v_today      date := current_date;
BEGIN
  v_students   := (SELECT count(*)::int FROM public.students WHERE is_active = true);
  v_teachers   := (SELECT count(*)::int FROM public.profiles WHERE role IN ('maestra','asistente'));
  v_classrooms := (SELECT count(*)::int FROM public.classrooms);
  v_attendance := (SELECT count(*)::int FROM public.attendance WHERE date = v_today AND status IN ('present','late','presente','tarde'));
  v_absent     := (SELECT count(*)::int FROM public.attendance WHERE date = v_today AND status IN ('absent','ausente'));
  v_pending    := COALESCE((SELECT sum(amount) FROM public.payments
                            WHERE status IN ('pending','overdue','review','pendiente','vencido')
                              AND deleted_at IS NULL), 0);
  v_review_count := COALESCE((SELECT count(*)::int FROM public.payments
                              WHERE status = 'review' AND deleted_at IS NULL), 0);
  v_incidents  := COALESCE((SELECT count(*)::int FROM public.inquiries WHERE status NOT IN ('resolved','closed')), 0);

  RETURN jsonb_build_object(
    'total',            v_students,
    'active',           v_students,
    'teachers',         v_teachers,
    'classrooms',       v_classrooms,
    'attendance_today', v_attendance,
    'absent_today',     v_absent,
    'pending_payments', v_pending,
    'pending_amount',   v_pending,
    'review_count',     v_review_count,
    'inquiries',        v_incidents
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Eliminar versión previa si existe
    BEGIN PERFORM cron.unschedule('karpus-mark-absent'); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Cada 15 minutos, de 11:00 a 23:00 UTC (07:00–19:00 hora RD)
    PERFORM cron.schedule(
      'karpus-mark-absent', '*/15 11-23 * * *',
      $cron$SELECT public.mark_absent_students();$cron$
    );
    RAISE NOTICE 'Cron karpus-mark-absent programado.';
  ELSE
    RAISE NOTICE 'pg_cron no instalado. Activar en Dashboard → Database → Extensions';
  END IF;
END $$;