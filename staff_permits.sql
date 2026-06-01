-- ============================================================
-- Tabla para Gestión de Permisos y Faltas (Staff)
-- ============================================================

CREATE TYPE permit_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE permit_type AS ENUM ('permission', 'absence', 'medical', 'other');

CREATE TABLE IF NOT EXISTS public.staff_permits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type permit_type DEFAULT 'permission',
    reason TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status permit_status DEFAULT 'pending',
    approved_by UUID REFERENCES public.profiles(id),
    comments TEXT,
    evidence_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS
ALTER TABLE public.staff_permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_own_permits" ON public.staff_permits
    FOR SELECT USING (auth.uid() = staff_id);

CREATE POLICY "staff_create_permits" ON public.staff_permits
    FOR INSERT WITH CHECK (auth.uid() = staff_id);

CREATE POLICY "admin_view_all_permits" ON public.staff_permits
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('directora', 'asistente', 'admin')
        )
    );

CREATE POLICY "admin_manage_permits" ON public.staff_permits
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('directora', 'asistente', 'admin')
        )
    );

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_staff_permits_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_update_staff_permits_timestamp
    BEFORE UPDATE ON public.staff_permits
    FOR EACH ROW EXECUTE FUNCTION update_staff_permits_timestamp();

-- Grant access
GRANT ALL ON public.staff_permits TO authenticated;
GRANT SELECT ON public.staff_permits TO anon;
