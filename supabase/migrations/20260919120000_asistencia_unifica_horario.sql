-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · UNIFICAR ASISTENCIA + AUSENCIAS CON LA CONFIGURACIÓN DE HORARIO
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivo:
--   Que el sistema de asistencia (ponche/late) y la detección automática de
--   ausentes trabajen SIEMPRE con la misma configuración de horario que edita
--   la directora (panel_directora.html → Horario de la Estancia).
--
-- Cambios:
--   1. mark_absent_students(): usa COALESCE(check_in_end, open_time): si no hay
--      un "límite de entrada" explícito, cae a la hora de apertura.
--   2. process_door_punch(): corrige la zona horaria (Russia/UTC → R.D.) y el
--      "tardanza" con COALESCE(check_in_end, open_time) igual que arriba.
--
-- Ejecutar en Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mark_absent_students()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date      := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_local_time  time      := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_settings    record;
  v_threshold   time;
  v_work_days   text[]    := ARRAY['Lun','Mar','Mié','Jue','Vie'];
  v_dow_name    text;
  v_student     record;
  v_att         record;
  v_reason      text;
  v_note        text;
  v_marked      integer   := 0;
  v_parents     uuid[]    := '{}';
  v_students    jsonb     := '[]'::jsonb;
BEGIN
  -- 1) Configuración del centro: hora límite de entrada + días laborables
  SELECT check_in_end, open_time, work_days INTO v_settings
  FROM public.school_settings WHERE id = 1;

  IF v_settings.work_days IS NOT NULL THEN
    BEGIN
      v_work_days := ARRAY(
        SELECT elem::text
        FROM jsonb_array_elements_text(v_settings.work_days::jsonb) AS elem
      );
    EXCEPTION WHEN OTHERS THEN
      v_work_days := ARRAY['Lun','Mar','Mié','Jue','Vie'];
    END;
  END IF;

  -- 2) Umbral = límite de entrada + 2 horas. Si no hay límite explícito, se usa la apertura.
  v_threshold := COALESCE(v_settings.check_in_end, v_settings.open_time) + interval '2 hours';

  IF v_threshold IS NULL THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 3) Todavía no ha pasado el umbral: no marcar ausentes
  IF v_local_time < v_threshold THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 4) ¿Es día laborable?
  v_dow_name := CASE extract(dow FROM v_today)
    WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar'
    WHEN 3 THEN 'Mié' WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie' WHEN 6 THEN 'Sáb'
  END;

  IF NOT (v_dow_name = ANY(v_work_days)) THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- 5) Marcar como ausentes a los estudiantes activos sin llegada
  FOR v_student IN
    SELECT id, classroom_id, name, parent_id
    FROM public.students
    WHERE is_active = true
      AND classroom_id IS NOT NULL
    ORDER BY id
  LOOP
    -- Motivo de ausencia si el padre ya la reportó (attendance_requests)
    v_reason := NULL; v_note := NULL;
    SELECT reason, note INTO v_reason, v_note
    FROM public.attendance_requests
    WHERE student_id = v_student.id AND date = v_today
      AND coalesce(status, '') IN ('pending', 'approved')
    ORDER BY updated_at DESC, id DESC
    LIMIT 1;

    SELECT * INTO v_att
    FROM public.attendance
    WHERE student_id = v_student.id AND date = v_today;

    IF v_att.id IS NULL THEN
      -- Sin registro de hoy → crear como ausente
      INSERT INTO public.attendance (student_id, classroom_id, date, status, school_year_id, absence_reason)
      VALUES (v_student.id, v_student.classroom_id, v_today, 'absent',
              (SELECT id FROM public.school_years WHERE status = 'active' ORDER BY id DESC LIMIT 1),
              v_reason)
      ON CONFLICT (student_id, date) DO NOTHING;
      IF FOUND THEN
        v_marked := v_marked + 1;
        IF v_student.parent_id IS NOT NULL AND NOT (v_student.parent_id = ANY(v_parents)) THEN
          v_parents := array_append(v_parents, v_student.parent_id);
        END IF;
        v_students := v_students || jsonb_build_object(
          'student_id', v_student.id, 'name', v_student.name, 'parent_id', v_student.parent_id,
          'reason', v_reason, 'note', v_note, 'absence_reason', v_reason
        );
      END IF;
    ELSIF coalesce(v_att.status, '__unmarked__') NOT IN ('present','late','retirado','absent') THEN
      -- Registro existente sin llegada (p. ej. marcado pendiente) → ausente
      UPDATE public.attendance
      SET status = 'absent', absence_reason = v_reason
      WHERE id = v_att.id;
      v_marked := v_marked + 1;
      IF v_student.parent_id IS NOT NULL AND NOT (v_student.parent_id = ANY(v_parents)) THEN
        v_parents := array_append(v_parents, v_student.parent_id);
      END IF;
      v_students := v_students || jsonb_build_object(
        'student_id', v_student.id, 'name', v_student.name, 'parent_id', v_student.parent_id,
        'reason', v_reason, 'note', v_note, 'absence_reason', v_reason
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'marked', v_marked,
    'parents', to_jsonb(v_parents),
    'students', v_students
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO service_role;
-- El terminal de ponche (attendance-live.html) corre como anon y dispara esta
-- función periódicamente, igual que process_door_punch (también anon). La
-- función es segura: solo marca ausentes tras el umbral y en días laborables.
GRANT EXECUTE ON FUNCTION public.mark_absent_students() TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- process_door_punch — asistencia del kiosco (attendance-live.html)
--   · Hora y fecha en zona de República Dominicana (antes usaba current_date/UTC).
--   · "Tardanza" cuando la hora local supera COALESCE(check_in_end, open_time).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
  v_limit    time;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success',false,'message','Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    -- Límite de entrada desde el horario configurado
    v_limit := COALESCE(v_settings.check_in_end, v_settings.open_time);
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_limit IS NOT NULL AND v_local_time > v_limit THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out'; v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'status', v_status, 'student_id', v_student.id, 'parent_id', v_parent,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes = trim(p_code) OR matricula = trim(p_code) OR access_code = trim(p_code))
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id = trim(p_code)::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_in', v_now, v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id, 'check_out', v_now, v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success', false, 'message', v_name || ' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'type', v_type, 'name', v_name, 'role', v_role,
      'student_id', null, 'parent_id', null,
      'time', to_char(v_now AT TIME ZONE 'America/Santo_Domingo', 'HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success', false, 'message', 'QR no registrado en el sistema');
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;