-- ============================================================
-- FIX: process_door_punch — Corregir Zona Horaria y Status
-- Para evitar que marquen tardanza por error de servidor (UTC)
-- y devolver el estado (presente/tardanza) al frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record;
  v_staff    record;
  v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (v_now AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text;
  v_name     text;
  v_role     text;
  v_parent   uuid;
  v_existing record;
  v_attendance record;
  v_status   text := 'present';
BEGIN
  -- 1. Buscar estudiante por matrícula
  SELECT * INTO v_student FROM public.students
  WHERE matricula = p_code AND is_active = true LIMIT 1;

  IF FOUND THEN
    v_name   := v_student.name;
    v_role   := 'Estudiante';
    v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;

    SELECT * INTO v_existing FROM public.door_punches
    WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';

    IF NOT FOUND THEN
      v_type := 'check_in';
      -- ✅ FIX: Comparar usando la hora local de Santo Domingo
      IF v_settings.check_in_end IS NOT NULL AND v_local_time > v_settings.check_in_end THEN
        v_status := 'late';
      END IF;

      -- Registrar en attendance
      SELECT * INTO v_attendance FROM public.attendance
      WHERE student_id = v_student.id AND date = v_today;
      
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        -- Si ya existe (ej. cargado por lote), actualizar el status y check_in
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;

      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date)
      VALUES (v_student.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      -- Es una salida
      SELECT * INTO v_existing FROM public.door_punches
      WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      
      IF NOT FOUND THEN
        v_type := 'check_out';
        v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance
        WHERE student_id = v_student.id AND date = v_today;
        
        IF v_attendance.id IS NOT NULL THEN
          UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id;
        END IF;
        
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date)
        VALUES (v_student.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success',    true,
      'type',       v_type,
      'name',       v_name,
      'role',       v_role,
      'status',     v_status,
      'student_id', v_student.id,
      'parent_id',  v_parent,
      'time',       to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM')
    );
  END IF;

  -- 2. Buscar staff por access_code, notes o matricula
  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes = p_code OR matricula = p_code OR access_code = p_code)
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;

  IF NOT FOUND THEN
    BEGIN
      SELECT * INTO v_staff FROM public.profiles
      WHERE id = p_code::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF FOUND THEN
    v_name := v_staff.name;
    v_role := initcap(v_staff.role);

    SELECT * INTO v_existing FROM public.door_punches
    WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';

    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date)
      VALUES (v_staff.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches
      WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date)
        VALUES (v_staff.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success',    true,
      'type',       v_type,
      'name',       v_name,
      'role',       v_role,
      'status',     'present',
      'student_id', null,
      'parent_id',  null,
      'time',       to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM')
    );
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'QR no registrado en el sistema');
END;
$$;
