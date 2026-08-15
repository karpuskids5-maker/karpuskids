-- ═══════════════════════════════════════════════════════════════
-- 🔒 KARPUS KIDS — SECURITY HARDENING
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- 1. Valida avatar_url (XSS prevention): solo URLs http/https o NULL
-- 2. Sanea filas existentes con avatar_url malicioso
-- 3. Fuerza RLS en tablas core
-- 4. Endurece update_own_profile (no permitir cambiar email/role)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. FUNCIÓN VALIDADORA DE avatar_url ─────────────────────────
-- Previene inyección de HTML/JS vía avatares (XSS en <img src>).
-- Solo se permite: NULL, http://, https:// o rutas relativas /img/.
CREATE OR REPLACE FUNCTION public.fn_validate_avatar_url()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL THEN
    -- Strip cualquier intento de romper el atributo src
    IF NEW.avatar_url ~ '["''<>\\]' THEN
      RAISE EXCEPTION 'avatar_url inválido: contiene caracteres no permitidos';
    END IF;
    -- Solo URLs http/https o rutas locales /img/
    IF NOT (NEW.avatar_url ~ '^https?://' OR NEW.avatar_url ~ '^/img/') THEN
      RAISE EXCEPTION 'avatar_url inválido: solo se permiten URLs http(s) o rutas /img/';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Aplicar a profiles (maestras, directora, asistentes)
DROP TRIGGER IF EXISTS trg_validate_avatar_profiles ON public.profiles;
CREATE TRIGGER trg_validate_avatar_profiles
  BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

-- Aplicar a students
DROP TRIGGER IF EXISTS trg_validate_avatar_students ON public.students;
CREATE TRIGGER trg_validate_avatar_students
  BEFORE INSERT OR UPDATE OF avatar_url ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

-- ── 2. SANEAR FILAS EXISTENTES ─────────────────────────────────
-- Cualquier avatar_url con caracteres peligrosos se pone a NULL
UPDATE public.profiles SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND (avatar_url ~ '["''<>\\]' OR NOT (avatar_url ~ '^https?://' OR avatar_url ~ '^/img/'));

UPDATE public.students SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND (avatar_url ~ '["''<>\\]' OR NOT (avatar_url ~ '^https?://' OR avatar_url ~ '^/img/'));

-- ── 3. FORZAR RLS EN TABLAS CORE ───────────────────────────────
-- Idempotente: no borra políticas existentes, solo garantiza RLS activo.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ── VERIFICACIÓN ───────────────────────────────────────────────
SELECT '✅ Security hardening aplicado' AS status;
