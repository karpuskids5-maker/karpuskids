-- ============================================================
-- FIX: School Years RLS — RPC functions to bypass RLS
-- ============================================================
-- Las políticas RLS en school_years requieren rol directora/admin
-- vía get_my_role().  Los RPC con SECURITY DEFINER bypass RLS
-- y verifican el rol explícitamente (patrón ya usado en
-- close_school_year, promote_students, etc.)
-- ============================================================

-- ── create_school_year ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_school_year(
  p_name            text,
  p_start_date      date,
  p_end_date        date,
  p_enrollment_start date DEFAULT NULL,
  p_enrollment_end  date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL,
  p_reenrollment_end date DEFAULT NULL,
  p_status          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_status   text;
  v_row      public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora o admin pueden crear años escolares');
  END IF;

  -- Auto-detectar status: si hay ventanas de inscripción → draft, si no → active
  IF p_status IS NOT NULL THEN
    v_status := p_status;
  ELSIF p_enrollment_start IS NOT NULL OR p_reenrollment_start IS NOT NULL THEN
    v_status := 'draft';
  ELSE
    v_status := 'active';
  END IF;

  INSERT INTO public.school_years (
    name, start_date, end_date,
    enrollment_start, enrollment_end,
    reenrollment_start, reenrollment_end,
    status, created_by
  ) VALUES (
    p_name, p_start_date, p_end_date,
    p_enrollment_start, p_enrollment_end,
    p_reenrollment_start, p_reenrollment_end,
    v_status, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'enrollment_start', v_row.enrollment_start,
    'enrollment_end', v_row.enrollment_end,
    'reenrollment_start', v_row.reenrollment_start,
    'reenrollment_end', v_row.reenrollment_end,
    'status', v_row.status,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_school_year(text, date, date, date, date, date, date, text) TO authenticated;

-- ── update_school_year ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_school_year(
  p_id              bigint,
  p_name            text DEFAULT NULL,
  p_start_date      date DEFAULT NULL,
  p_end_date        date DEFAULT NULL,
  p_enrollment_start date DEFAULT NULL,
  p_enrollment_end  date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL,
  p_reenrollment_end date DEFAULT NULL,
  p_status          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_row  public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora o admin pueden modificar años escolares');
  END IF;

  UPDATE public.school_years
  SET
    name               = COALESCE(p_name, name),
    start_date         = COALESCE(p_start_date, start_date),
    end_date           = COALESCE(p_end_date, end_date),
    enrollment_start   = COALESCE(p_enrollment_start, enrollment_start),
    enrollment_end     = COALESCE(p_enrollment_end, enrollment_end),
    reenrollment_start = COALESCE(p_reenrollment_start, reenrollment_start),
    reenrollment_end   = COALESCE(p_reenrollment_end, reenrollment_end),
    status             = CASE WHEN p_status IS NOT NULL THEN p_status ELSE status END
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Año escolar no encontrado');
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'enrollment_start', v_row.enrollment_start,
    'enrollment_end', v_row.enrollment_end,
    'reenrollment_start', v_row.reenrollment_start,
    'reenrollment_end', v_row.reenrollment_end,
    'status', v_row.status,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_school_year(bigint, text, date, date, date, date, date, date, text) TO authenticated;

-- ── create_academic_period ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_academic_period(
  p_school_year_id  bigint,
  p_name            text,
  p_start_date      date,
  p_end_date        date,
  p_order_index     integer,
  p_status          text DEFAULT 'pending',
  p_is_active       boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_row  public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'maestra', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'Sin permisos para crear períodos');
  END IF;

  INSERT INTO public.academic_periods (
    school_year_id, name, start_date, end_date,
    order_index, status, is_active
  ) VALUES (
    p_school_year_id, p_name, p_start_date, p_end_date,
    p_order_index, p_status, p_is_active
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'school_year_id', v_row.school_year_id,
    'name', v_row.name,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'order_index', v_row.order_index,
    'status', v_row.status,
    'is_active', v_row.is_active,
    'created_at', v_row.created_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_academic_period(bigint, text, date, date, integer, text, boolean) TO authenticated;

-- ── delete_academic_periods_by_year ─────────────────────────
CREATE OR REPLACE FUNCTION public.delete_academic_periods_by_year(
  p_school_year_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_count int;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'maestra', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'Sin permisos para eliminar períodos');
  END IF;

  DELETE FROM public.academic_periods
  WHERE school_year_id = p_school_year_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_academic_periods_by_year(bigint) TO authenticated;

-- ── get_first_academic_period ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_first_academic_period(
  p_school_year_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_row public.academic_periods%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.academic_periods
  WHERE school_year_id = p_school_year_id
  ORDER BY order_index
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'id', v_row.id,
    'school_year_id', v_row.school_year_id,
    'name', v_row.name,
    'order_index', v_row.order_index
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_first_academic_period(bigint) TO authenticated;

-- ── activate_academic_period ────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_academic_period(
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_period public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'maestra', 'asistente', 'admin') THEN
    RETURN jsonb_build_object('error', 'Sin permisos para activar períodos');
  END IF;

  -- Obtener el período a activar
  SELECT * INTO v_period FROM public.academic_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Período no encontrado');
  END IF;

  -- Desactivar todos los períodos del mismo año
  UPDATE public.academic_periods
  SET is_active = false
  WHERE school_year_id = v_period.school_year_id;

  -- Activar el período solicitado
  UPDATE public.academic_periods
  SET is_active = true, status = 'open'
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_period.id,
    'name', v_period.name,
    'school_year_id', v_period.school_year_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_academic_period(bigint) TO authenticated;
