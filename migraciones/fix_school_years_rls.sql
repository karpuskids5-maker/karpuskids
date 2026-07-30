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
  p_reenrollment_end date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  text;
  v_row   public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no autenticado o sin perfil');
  END IF;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora o admin pueden crear años escolares');
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
    'draft', auth.uid()
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
GRANT EXECUTE ON FUNCTION public.create_school_year(text, date, date, date, date, date, date) TO authenticated;

-- ── update_school_year ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_school_year(
  p_id              bigint,
  p_name            text DEFAULT NULL,
  p_start_date      date DEFAULT NULL,
  p_end_date        date DEFAULT NULL,
  p_enrollment_start date DEFAULT NULL,
  p_enrollment_end  date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL,
  p_reenrollment_end date DEFAULT NULL
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
    reenrollment_end   = COALESCE(p_reenrollment_end, reenrollment_end)
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
GRANT EXECUTE ON FUNCTION public.update_school_year(bigint, text, date, date, date, date, date, date) TO authenticated;
