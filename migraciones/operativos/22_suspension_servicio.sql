-- ═══════════════════════════════════════════════════════════════
-- 22 · SUSPENSIÓN TEMPORAL DEL SERVICIO
-- -----------------------------------------------------------------
-- Propuesta: suspensión por falta de pago / estado de la empresa.
-- Aplica a la única empresa (school_settings singleton id = 1).
--
-- Reglas:
--   · status default = 'active'  →  sistema funciona normal.
--   · status = 'suspended'       →  solo rol 'admin' (dueño) accede.
--   · No elimina datos ni usuarios.
--   · El motivo NUNCA se expone al cliente (columna interna).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. COLUMNAS DE ESTADO (solo si no existen) ───────────────────────
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended'));
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS suspended_at timestamp with time zone;
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS suspension_reason text;

COMMENT ON COLUMN public.school_settings.status IS 'Estado del servicio: active (normal) o suspended (bloqueado).';
COMMENT ON COLUMN public.school_settings.suspended_at IS 'Timestamp de la última suspensión. NULL si está activo.';
COMMENT ON COLUMN public.school_settings.suspension_reason IS 'Motivo interno de la suspensión. NUNCA mostrar al cliente.';

-- Mantener el singular active por si alguien lo marcó manual mal (defensa extra)
UPDATE public.school_settings SET status = 'active' WHERE id = 1 AND status IS NULL;

-- ── 2. RLS EN school_settings ─────────────────────────────────────────
-- Lectura para cualquier usuario autenticado (para saber el estado).
DROP POLICY IF EXISTS "school_settings_select" ON public.school_settings;
CREATE POLICY "school_settings_select" ON public.school_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Escritura SOLO admin/directora (panel de control). El rol autenticado
-- común NO puede modificar el estado del servicio. Incluye INSERT por si
-- algún flujo (pagos) hace upsert de la fila id=1.
DROP POLICY IF EXISTS "school_settings_insert" ON public.school_settings;
CREATE POLICY "school_settings_insert" ON public.school_settings FOR INSERT
  WITH CHECK (get_my_role() IN ('admin','directora'));

DROP POLICY IF EXISTS "school_settings_update" ON public.school_settings;
CREATE POLICY "school_settings_update" ON public.school_settings FOR UPDATE
  USING (get_my_role() IN ('admin','directora'))
  WITH CHECK (get_my_role() IN ('admin','directora'));

-- ── 3. FUNCIÓN AUTORITATIVA (SERVER-SIDE) ─────────────────────────────
-- SECURITY DEFINER: lee el estado real sin depender del frontend.
-- Es la única fuente de verdad que consultan login y los paneles.
CREATE OR REPLACE FUNCTION public.is_business_suspended()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _status text;
BEGIN
  SELECT status INTO _status FROM public.school_settings WHERE id = 1;
  RETURN COALESCE(_status, 'active') = 'suspended';
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_business_suspended() TO authenticated;

-- También exponer el motivo y la fecha (solo para el dueño/admin en el panel)
CREATE OR REPLACE FUNCTION public.get_business_suspension_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.school_settings%ROWTYPE;
  _role text;
BEGIN
  SELECT get_my_role() INTO _role;
  IF _role IS NULL OR _role NOT IN ('admin','directora') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _row FROM public.school_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'status',           _row.status,
    'suspended_at',     _row.suspended_at,
    'suspension_reason', _row.suspension_reason
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_business_suspension_info() TO authenticated;

-- ── 4. RPC GESTIÓN: SUSPENDER / REACTIVAR (solo admin/directora) ───────
CREATE OR REPLACE FUNCTION public.set_business_suspended(p_suspended boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text;
BEGIN
  SELECT get_my_role() INTO _role;
  IF _role IS NULL OR _role NOT IN ('admin','directora') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sin_permiso');
  END IF;

  IF p_suspended THEN
    UPDATE public.school_settings
      SET status = 'suspended',
          suspended_at = now(),
          suspension_reason = COALESCE(p_reason, 'Falta de pago de mensualidad')
      WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'status', 'suspended', 'suspended_at', now());
  ELSE
    UPDATE public.school_settings
      SET status = 'active',
          suspended_at = NULL,
          suspension_reason = NULL
      WHERE id = 1;
    RETURN jsonb_build_object('ok', true, 'status', 'active');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_business_suspended(boolean, text) TO authenticated;

-- ── 5. AUDITORÍA DE LOS CAMBIOS DE ESTADO ──────────────────────────────
-- Registra quién suspendió/reactivó y cuándo (audit_logs ya usado por el sistema).
CREATE OR REPLACE FUNCTION public.log_business_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (user_id, action, payload)
    VALUES (
      auth.uid(),
      'business.status_change',
      jsonb_build_object(
        'from',   OLD.status,
        'to',     NEW.status,
        'by',     auth.uid(),
        'at',     NEW.suspended_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_settings_status ON public.school_settings;
CREATE TRIGGER trg_school_settings_status
  AFTER UPDATE OF status ON public.school_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_business_status_change();