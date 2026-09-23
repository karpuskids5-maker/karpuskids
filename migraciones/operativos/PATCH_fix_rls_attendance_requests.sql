-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · PARCHE URGENTE — Políticas RLS para attendance_requests
-- ═══════════════════════════════════════════════════════════════════════════
-- SÍNTOMA: El padre intenta enviar una "Excusa de Ausencia" y recibe:
--   "new row violates row-level security policy for table attendance_requests"
-- CAUSA:   La migración 03 habilitó RLS en attendance_requests (ENABLE ROW
--          LEVEL SECURITY) pero nunca se crearon políticas para la tabla.
--          Sin políticas, PostgreSQL deniega TODO por defecto (INSERT incluido).
-- ACCIÓN:  Ejecutar este script en Supabase → SQL Editor.
--          Es idempotente (DROP POLICY IF EXISTS): puede re-ejecutarse sin daño.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. STAFF (directora, asistente, maestra, admin): lectura de solicitudes
DROP POLICY IF EXISTS "attendance_requests_staff" ON public.attendance_requests;
CREATE POLICY "attendance_requests_staff" ON public.attendance_requests FOR SELECT
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

-- 2. STAFF: actualizar (aprobar / rechazar) solicitudes
DROP POLICY IF EXISTS "attendance_requests_staff_update" ON public.attendance_requests;
CREATE POLICY "attendance_requests_staff_update" ON public.attendance_requests FOR UPDATE
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));

-- 3. PADRE: leer las solicitudes de sus propios hijos
DROP POLICY IF EXISTS "attendance_requests_parent_select" ON public.attendance_requests;
CREATE POLICY "attendance_requests_parent_select" ON public.attendance_requests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = attendance_requests.student_id
      AND s.parent_id = auth.uid()
  ));

-- 4. PADRE: crear una excusa de ausencia para su propio hijo
DROP POLICY IF EXISTS "attendance_requests_parent_insert" ON public.attendance_requests;
CREATE POLICY "attendance_requests_parent_insert" ON public.attendance_requests FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = attendance_requests.student_id
      AND s.parent_id = auth.uid()
  ));

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL PARCHE
-- ═══════════════════════════════════════════════════════════════════════════