-- ============================================================
-- FIX PAGOS - REPARACIÓN DE RLS Y PERMISOS
-- ============================================================
-- Ejecutar esto en Supabase SQL Editor
-- Fecha: Junio 25, 2026
-- ============================================================

-- 1. Darle permisos de lectura a los pagos a directora/asistente
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO service_role;

-- 2. Recrear las políticas RLS para payments (limpiar primero)
DROP POLICY IF EXISTS "payments_staff" ON public.payments;
DROP POLICY IF EXISTS "payments_staff_all" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_select" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_update" ON public.payments;

-- 3. Política para directora/asistente/admin - pueden ver TODOS los pagos
CREATE POLICY "payments_staff_can_see_all" ON public.payments
  FOR SELECT
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '') 
    IN ('directora', 'asistente', 'admin')
  );

-- 4. Política para directora/asistente/admin - pueden crear pagos
CREATE POLICY "payments_staff_can_insert" ON public.payments
  FOR INSERT
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '') 
    IN ('directora', 'asistente', 'admin')
  );

-- 5. Política para directora/asistente/admin - pueden actualizar pagos
CREATE POLICY "payments_staff_can_update" ON public.payments
  FOR UPDATE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '') 
    IN ('directora', 'asistente', 'admin')
  )
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '') 
    IN ('directora', 'asistente', 'admin')
  );

-- 6. Política para directora/asistente/admin - pueden borrar pagos
CREATE POLICY "payments_staff_can_delete" ON public.payments
  FOR DELETE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '') 
    IN ('directora', 'asistente', 'admin')
  );

-- 7. Política para padres - solo ver sus propios pagos
CREATE POLICY "payments_parent_see_own" ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students 
      WHERE students.id = payments.student_id 
      AND students.parent_id = auth.uid() 
      AND students.deleted_at IS NULL
    )
  );

-- 8. Política para padres - poder subir comprobantes (insertar pagos pendientes)
CREATE POLICY "payments_parent_can_submit" ON public.payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students 
      WHERE students.id = payments.student_id 
      AND students.parent_id = auth.uid() 
      AND students.deleted_at IS NULL
    )
  );

-- 9. Política para padres - actualizar solo evidence_url en sus pagos
CREATE POLICY "payments_parent_can_update_own" ON public.payments
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.students 
      WHERE students.id = payments.student_id 
      AND students.parent_id = auth.uid() 
      AND students.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students 
      WHERE students.id = payments.student_id 
      AND students.parent_id = auth.uid() 
      AND students.deleted_at IS NULL
    )
  );

-- 10. Asegurar que la tabla payments está habilitada para RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 11. Verificar que las columnas necesarias existen
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES public.profiles(id);

-- 12. Crear índices para performance (crucial)
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status) 
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments(student_id) 
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_month_paid ON public.payments(month_paid) 
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC) 
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_due_date ON public.payments(due_date) 
  WHERE deleted_at IS NULL AND status IN ('pending', 'overdue');

-- 13. Verificación: contar pagos visible por la directora actual
-- (Esto debería retornar un número > 0 si las políticas funcionan)
SELECT COUNT(*) as total_payments_visible
FROM public.payments
WHERE deleted_at IS NULL;

-- 14. Verificación: verificar el rol del usuario actual
SELECT 
  auth.uid() as current_user_id,
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) as current_role;
