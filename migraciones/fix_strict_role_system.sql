-- ============================================================
-- KARPUS KIDS — SISTEMA DE ROLES ESTRICTO
-- Implementa:
-- 1. RLS más estrictos para perfiles
-- 2. Solo directora/admin pueden modificar roles
-- 3. Auditoría completa de cambios de roles
-- ============================================================

-- 1. ACTUALIZAR POLÍTICAS RLS PARA PROFILES (MÁS ESTRICTOS)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;

-- SELECT: Usuarios pueden ver su propio perfil, o staff puede ver todos
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND (
    auth.uid() = id OR
    get_my_role() IN ('directora', 'asistente', 'admin')
  )
);

-- INSERT: Solo directora/admin pueden crear nuevos perfiles
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (
  get_my_role() IN ('directora', 'admin')
);

-- UPDATE: Solo directora/admin pueden modificar, y solo ellos pueden cambiar el rol
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (
  deleted_at IS NULL AND (
    auth.uid() = id OR
    get_my_role() IN ('directora', 'admin')
  )
) WITH CHECK (
  deleted_at IS NULL AND (
    (auth.uid() = id AND (role = OLD.role OR role IS NULL)) OR
    get_my_role() IN ('directora', 'admin')
  )
);

-- DELETE: Solo directora/admin pueden borrar (soft delete)
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE USING (
  get_my_role() IN ('directora', 'admin')
);

-- 2. FUNCIÓN PARA VALIDAR CAMBIOS DE ROL (solo directora/admin)
CREATE OR REPLACE FUNCTION public.fn_validate_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_role text;
BEGIN
  -- Obtener rol del usuario que está haciendo la modificación
  SELECT role INTO v_current_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;

  -- Si es INSERT y no es directora/admin, denegar
  IF TG_OP = 'INSERT' AND v_current_role NOT IN ('directora', 'admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden crear perfiles';
  END IF;

  -- Si es UPDATE y el rol está cambiando y no es directora/admin, denegar
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role AND v_current_role NOT IN ('directora', 'admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden modificar roles';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. TRIGGER PARA VALIDAR CAMBIOS DE ROL
DROP TRIGGER IF EXISTS trg_validate_role_change ON public.profiles;
CREATE TRIGGER trg_validate_role_change
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_role_change();

-- 4. AUMENTAR AUDITORÍA DE CAMBIOS DE PERFIL
CREATE OR REPLACE FUNCTION public.fn_audit_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'profile.created';
    v_payload := jsonb_build_object(
      'target_user', NEW.id,
      'name', NEW.name,
      'email', NEW.email,
      'role', NEW.role
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := CASE
      WHEN OLD.role IS DISTINCT FROM NEW.role THEN 'profile.role_changed'
      ELSE 'profile.updated'
    END;
    v_payload := jsonb_build_object(
      'target_user', NEW.id,
      'old', jsonb_build_object(
        'name', OLD.name,
        'email', OLD.email,
        'role', OLD.role
      ),
      'new', jsonb_build_object(
        'name', NEW.name,
        'email', NEW.email,
        'role', NEW.role
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'profile.deleted';
    v_payload := jsonb_build_object(
      'target_user', OLD.id,
      'name', OLD.name,
      'email', OLD.email,
      'role', OLD.role
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (auth.uid(), v_action, v_payload, now())
  ON CONFLICT DO NOTHING;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_role_change ON public.profiles;
CREATE TRIGGER audit_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_role_change();

-- 5. Asegurar que la tabla profiles tenga todas las columnas necesarias
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_code TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS matricula TEXT UNIQUE;

-- 6. Crear índice adicional para búsqueda por rol
CREATE INDEX IF NOT EXISTS idx_profiles_role_deleted ON public.profiles(role, deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT '✅ Sistema de roles estricto implementado' AS status;
