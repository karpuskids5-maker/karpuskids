-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 24 — CORRECCIÓN CONTEO DE AUSENTES
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema:
--   get_dashboard_kpis() solo contaba estudiantes con registro status='absent'
--   en la tabla attendance. Si mark_absent_students() aún no había corrido
--   (o el umbral check_in_end + 2h no se había alcanzado), los estudiantes
--   sin NINGÚN registro no se contaban como ausentes.
--
-- Solución:
--   El conteo de ausentes ahora usa la misma lógica que el panel de control:
--   ausentes = estudiantes activos sin registro de presente/tarde/retirado hoy.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_month text DEFAULT '%')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_students     int;
  v_teachers     int;
  v_classrooms   int;
  v_attendance   int;
  v_absent       int;
  v_pending      numeric;
  v_review_count int;
  v_incidents    int;
  v_today        date := current_date;
BEGIN
  v_students   := (SELECT count(*)::int FROM public.students WHERE is_active = true);
  v_teachers   := (SELECT count(*)::int FROM public.profiles WHERE role IN ('maestra','asistente'));
  v_classrooms := (SELECT count(*)::int FROM public.classrooms);

  -- Presentes hoy: registros con estado presente/tarde
  v_attendance := (SELECT count(*)::int FROM public.attendance
                   WHERE date = v_today
                     AND status IN ('present','late','presente','tarde'));

  -- ✅ AUSENTES CORREGIDO: estudiantes activos SIN registro de presente/tarde/retirado hoy
  -- Incluye tanto los marcados como 'absent' como los que aún no tienen registro.
  v_absent := (SELECT count(*)::int FROM public.students s
               WHERE s.is_active = true
                 AND s.classroom_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM public.attendance a
                   WHERE a.student_id = s.id
                     AND a.date = v_today
                     AND a.status IN ('present','late','presente','tarde','retirado')
                 ));

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
