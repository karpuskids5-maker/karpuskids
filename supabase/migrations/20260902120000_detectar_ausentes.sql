-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · MIGRACIÓN 17 — DETECCIÓN AUTOMÁTICA DE ESTUDIANTES AUSENTES
-- ═══════════════════════════════════════════════════════════════════════════
-- Objetivo:
--   Detectar automáticamente a los estudiantes que no han llegado y marcarlos
--   como `absent` en la tabla `attendance`, cuando ya haya pasado la hora de
--   entrada (check_in_end) + 2 horas. Se ejecuta al abrir el panel de la
--   maestra (y periódicamente mientras esté abierto).
--
-- Reglas:
--   1. Solo aplica en días laborables (school_settings.work_days).
--   2. Solo una vez ha pasado el umbral: check_in_end + interval '2 hours'.
--   3. NO sobrescribe a quienes ya tienen un estado final:
--      present / late / retirado / absent.
--   4. Es idempotente y a prueba de reintentos.
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
  SELECT check_in_end, work_days INTO v_settings
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

  -- 2) Sin horario configurado no hacemos nada
  IF v_settings.check_in_end IS NULL THEN
    RETURN jsonb_build_object('marked', 0, 'parents', '[]'::jsonb, 'students', '[]'::jsonb);
  END IF;

  -- Umbral = hora de entrada + 2 horas
  v_threshold := v_settings.check_in_end + interval '2 hours';

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

-- Columna para guardar el motivo de la ausencia (si lo reportó el padre)
-- Permite al padre ver el motivo en su calendario/historial sin unir tablas.
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS absence_reason text;
