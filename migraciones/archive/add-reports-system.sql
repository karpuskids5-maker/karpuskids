
-- ============================================================
-- KARPUS KIDS — Sistema de Reportes v1.0
-- Añade tablas, triggers y políticas RLS para el sistema de reportes
-- ============================================================

-- ── 1. Tabla de Reportes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_number TEXT UNIQUE NOT NULL,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reporter_role TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'parent')),
  target_id UUID NOT NULL REFERENCES public.profiles(id),
  category TEXT NOT NULL CHECK (category IN ('conduct', 'academic', 'attendance', 'communication', 'other')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'escalated', 'closed')),
  required_actions TEXT[],
  follow_up_date TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID REFERENCES public.profiles(id),
  is_confidential BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  tags TEXT[],
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_reports_target ON public.reports(target_type, target_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_severity ON public.reports(severity, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_created ON public.reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports(reporter_id, deleted_at);

-- ── 2. Tabla de Historial de Reportes ────────────────────────
CREATE TABLE IF NOT EXISTS public.report_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES public.profiles(id),
  old_values JSONB,
  new_values JSONB,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_history_report ON public.report_history(report_id, created_at DESC);

-- ── 3. Tabla de Adjuntos de Reportes ─────────────────────────
CREATE TABLE IF NOT EXISTS public.report_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_report_attachments_report ON public.report_attachments(report_id, deleted_at);

-- ── 4. Tabla de Acciones de Reportes ─────────────────────────
CREATE TABLE IF NOT EXISTS public.report_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  assigned_to UUID REFERENCES public.profiles(id),
  completed_by UUID REFERENCES public.profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_actions_report ON public.report_actions(report_id, status);
CREATE INDEX IF NOT EXISTS idx_report_actions_assigned ON public.report_actions(assigned_to, status);

-- ── 5. Función para setear updated_at automáticamente ────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar updated_at
DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;
CREATE TRIGGER set_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_report_actions_updated_at ON public.report_actions;
CREATE TRIGGER set_report_actions_updated_at
  BEFORE UPDATE ON public.report_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 6. Políticas RLS para Reportes ───────────────────────────
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Sólo directora/admin pueden ver todos los reportes
-- Los destinatarios pueden ver sus propios reportes
DROP POLICY IF EXISTS "reports_select" ON public.reports;
CREATE POLICY "reports_select" ON public.reports FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin') OR
    target_id = auth.uid() OR
    reporter_id = auth.uid()
  )
);

-- Sólo directora/admin pueden crear reportes
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- Sólo directora/admin pueden actualizar reportes
DROP POLICY IF EXISTS "reports_update" ON public.reports;
CREATE POLICY "reports_update" ON public.reports FOR UPDATE USING (
  deleted_at IS NULL AND (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- Sólo directora/admin pueden eliminar (soft delete)
DROP POLICY IF EXISTS "reports_delete" ON public.reports;
CREATE POLICY "reports_delete" ON public.reports FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- ── 7. Políticas RLS para Historial de Reportes ──────────────
ALTER TABLE public.report_history ENABLE ROW LEVEL SECURITY;

-- Sólo directora/admin pueden ver el historial
DROP POLICY IF EXISTS "report_history_select" ON public.report_history;
CREATE POLICY "report_history_select" ON public.report_history FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- Sólo directora/admin pueden crear historial
DROP POLICY IF EXISTS "report_history_insert" ON public.report_history;
CREATE POLICY "report_history_insert" ON public.report_history FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- ── 8. Políticas RLS para Adjuntos ───────────────────────────
ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario con acceso al reporte puede ver sus adjuntos
DROP POLICY IF EXISTS "report_attachments_select" ON public.report_attachments;
CREATE POLICY "report_attachments_select" ON public.report_attachments FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin') OR
    EXISTS (SELECT 1 FROM public.reports WHERE id = report_id AND target_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.reports WHERE id = report_id AND reporter_id = auth.uid())
  )
);

-- Sólo directora/admin pueden crear adjuntos
DROP POLICY IF EXISTS "report_attachments_insert" ON public.report_attachments;
CREATE POLICY "report_attachments_insert" ON public.report_attachments FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- Sólo directora/admin pueden eliminar adjuntos
DROP POLICY IF EXISTS "report_attachments_delete" ON public.report_attachments;
CREATE POLICY "report_attachments_delete" ON public.report_attachments FOR DELETE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- ── 9. Políticas RLS para Acciones ───────────────────────────
ALTER TABLE public.report_actions ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario con acceso al reporte puede ver sus acciones
DROP POLICY IF EXISTS "report_actions_select" ON public.report_actions;
CREATE POLICY "report_actions_select" ON public.report_actions FOR SELECT USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin') OR
  EXISTS (SELECT 1 FROM public.reports WHERE id = report_id AND target_id = auth.uid()) OR
  assigned_to = auth.uid()
);

-- Sólo directora/admin pueden crear acciones
DROP POLICY IF EXISTS "report_actions_insert" ON public.report_actions;
CREATE POLICY "report_actions_insert" ON public.report_actions FOR INSERT WITH CHECK (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- Sólo directora/admin pueden actualizar acciones
DROP POLICY IF EXISTS "report_actions_update" ON public.report_actions;
CREATE POLICY "report_actions_update" ON public.report_actions FOR UPDATE USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('directora', 'admin')
);

-- ── 10. Trigger para Historial de Cambios ─────────────────────
CREATE OR REPLACE FUNCTION public.audit_report_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_action TEXT;
  v_old_values JSONB;
  v_new_values JSONB;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_action := 'created';
    v_old_values := NULL;
    v_new_values := to_jsonb(NEW);
  ELSIF (TG_OP = 'UPDATE') THEN
    v_action := 'updated';
    v_old_values := to_jsonb(OLD);
    v_new_values := to_jsonb(NEW);
  ELSIF (TG_OP = 'DELETE') THEN
    v_action := 'deleted';
    v_old_values := to_jsonb(OLD);
    v_new_values := NULL;
  END IF;

  INSERT INTO public.report_history (
    report_id,
    action,
    changed_by,
    old_values,
    new_values
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    v_action,
    v_user_id,
    v_old_values,
    v_new_values
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Añadir trigger de auditoría
DROP TRIGGER IF EXISTS audit_report_changes ON public.reports;
CREATE TRIGGER audit_report_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION audit_report_change();

-- ── 11. Función Helper para Obtener Rol de Usuario ───────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
