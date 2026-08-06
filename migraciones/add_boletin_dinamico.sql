-- ============================================================
-- Karpus Kids — Boletín Dinámico v1
-- Motor automático del boletín: promedios en tiempo real por
-- área y período + fortalezas/debilidades/comentario + QR/PDF.
-- Reutiliza el esquema V2 (periods, period_config, activities,
-- grades, subjects, report_cards). Ejecutar en Supabase SQL Editor.
-- ============================================================

-- ── 1. Columnas nuevas en report_cards ───────────────────────
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS fortalezas        text[] DEFAULT '{}';
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS debilidades       text[] DEFAULT '{}';
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS directora_comment text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS conducta          text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS qr_code           text;
ALTER TABLE public.report_cards ADD COLUMN IF NOT EXISTS pdf_url           text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'report_cards' AND column_name = 'conducta'
  ) THEN
    ALTER TABLE public.report_cards DROP CONSTRAINT IF EXISTS report_cards_conducta_check;
    ALTER TABLE public.report_cards ADD CONSTRAINT report_cards_conducta_check
      CHECK (conducta IN ('Excelente','Muy buena','Buena','Regular'));
  END IF;
END $$;

-- ── 2. RPC: Boletín completo de un estudiante (tiempo real) ──
-- Calcula promedios por área igual que close_period (mejores 5
-- si hay 5+ notas, si no todas), promedio general y nivel.
-- Devuelve TODO lo necesario para generar el boletín y su PDF.
DROP FUNCTION IF EXISTS public.get_student_boletin(bigint, bigint);
CREATE OR REPLACE FUNCTION public.get_student_boletin(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id    uuid;
  v_role       text;
  v_student    record;
  v_period     record;
  v_area       record;
  v_count      int;
  v_avg        numeric(5,2);
  v_total      numeric(5,2) := 0;
  v_area_count int := 0;
  v_level      text;
  v_areas      jsonb := '[]'::jsonb;
  v_acts       jsonb;
  v_report     record;
  v_att        record;
  v_pct        numeric(5,2);
  v_directora  text;
  v_year       text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students
      WHERE id = p_student_id AND parent_id = v_user_id
    ) THEN
      RETURN jsonb_build_object('error', 'Acceso denegado');
    END IF;
  END IF;

  SELECT s.id, s.name, s.matricula, s.age, s.age_type, s.avatar_url,
         s.birth_date,
         s.classroom_id, c.name AS classroom_name, c.level AS classroom_level,
         t.name AS teacher_name
  INTO v_student
  FROM public.students s
  LEFT JOIN public.classrooms c ON c.id = s.classroom_id
  LEFT JOIN public.profiles t ON t.id = c.teacher_id
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Estudiante no encontrado');
  END IF;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Periodo no encontrado');
  END IF;

  SELECT name INTO v_directora
  FROM public.profiles
  WHERE role = 'directora'
  ORDER BY created_at
  LIMIT 1;

  SELECT name INTO v_year
  FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY created_at DESC
  LIMIT 1;

  -- Áreas configuradas en el período con promedio en tiempo real
  FOR v_area IN
    SELECT pc.subject_id, s.name AS subject_name, pc.activity_count
    FROM public.period_config pc
    JOIN public.subjects s ON s.id = pc.subject_id
    WHERE pc.period_id = p_period_id
    ORDER BY s.name
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM public.grades g
    JOIN public.activities a ON a.id = g.activity_id
    JOIN public.period_config pc ON pc.id = a.config_id
    WHERE pc.period_id = p_period_id
      AND pc.subject_id = v_area.subject_id
      AND g.student_id = p_student_id
      AND g.score_v2 IS NOT NULL;

    IF v_count >= 5 THEN
      SELECT ROUND(AVG(score_v2), 2) INTO v_avg
      FROM (
        SELECT g.score_v2
        FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        JOIN public.period_config pc ON pc.id = a.config_id
        WHERE pc.period_id = p_period_id
          AND pc.subject_id = v_area.subject_id
          AND g.student_id = p_student_id
          AND g.score_v2 IS NOT NULL
        ORDER BY g.score_v2 DESC
        LIMIT 5
      ) best_scores;
    ELSE
      SELECT ROUND(AVG(g.score_v2), 2) INTO v_avg
      FROM public.grades g
      JOIN public.activities a ON a.id = g.activity_id
      JOIN public.period_config pc ON pc.id = a.config_id
      WHERE pc.period_id = p_period_id
        AND pc.subject_id = v_area.subject_id
        AND g.student_id = p_student_id
        AND g.score_v2 IS NOT NULL;
    END IF;

    IF v_avg IS NOT NULL THEN
      v_total := v_total + v_avg;
      v_area_count := v_area_count + 1;
    END IF;

    v_areas := v_areas || jsonb_build_object(
      'subject_id',     v_area.subject_id,
      'subject_name',   v_area.subject_name,
      'activity_count', v_area.activity_count,
      'graded_count',   v_count,
      'average',        v_avg,
      'method',         CASE WHEN v_count >= 5 THEN 'best_5' ELSE 'all' END
    );
  END LOOP;

  -- Detalle de actividades calificadas del estudiante
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'subject_id',      pc.subject_id,
        'subject_name',    s.name,
        'activity_id',     a.id,
        'activity_title',  a.title,
        'activity_number', a.activity_number,
        'score',           g.score_v2,
        'comment',         g.notes
      )
      ORDER BY s.name, a.activity_number
    ),
    '[]'::jsonb
  ) INTO v_acts
  FROM public.grades g
  JOIN public.activities a ON a.id = g.activity_id
  JOIN public.period_config pc ON pc.id = a.config_id
  JOIN public.subjects s ON s.id = pc.subject_id
  WHERE g.student_id = p_student_id
    AND pc.period_id = p_period_id
    AND g.score_v2 IS NOT NULL;

  IF v_area_count > 0 THEN
    v_total := ROUND(v_total / v_area_count, 2);
  ELSE
    v_total := NULL;
  END IF;

  v_level := CASE
    WHEN v_total IS NULL THEN 'Sin calificar'
    WHEN v_total >= 90   THEN 'Excelente'
    WHEN v_total >= 80   THEN 'Bueno'
    WHEN v_total >= 70   THEN 'En proceso'
    ELSE                      'Requiere apoyo'
  END;

  SELECT * INTO v_report
  FROM public.report_cards
  WHERE student_id = p_student_id AND period_id = p_period_id;

  -- Asistencia del estudiante dentro del rango de fechas del período
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('present','retirado','late'))  AS asistidos,
    COUNT(*) FILTER (WHERE a.status = 'absent')                        AS ausencias,
    COUNT(*) FILTER (WHERE a.status = 'late')                          AS tardanzas,
    COUNT(*)                                                            AS total
  INTO v_att
  FROM public.attendance a
  WHERE a.student_id = p_student_id
    AND (v_period.start_date IS NULL OR a.date >= v_period.start_date)
    AND (v_period.end_date IS NULL OR a.date <= v_period.end_date);

  v_pct := CASE
    WHEN v_att.total > 0
      THEN ROUND(v_att.asistidos::numeric / v_att.total * 100, 1)
    ELSE NULL END;

  RETURN jsonb_build_object(
    'student', jsonb_build_object(
      'id',         v_student.id,
      'name',       v_student.name,
      'matricula',  v_student.matricula,
      'age',        v_student.age,
      'age_type',   v_student.age_type,
      'birth_date', v_student.birth_date,
      'avatar_url', v_student.avatar_url
    ),
    'classroom', jsonb_build_object(
      'id',    v_student.classroom_id,
      'name',  v_student.classroom_name,
      'level', v_student.classroom_level
    ),
    'teacher_name',    v_student.teacher_name,
    'directora_name',  v_directora,
    'school_year_name',v_year,
    'period', jsonb_build_object(
      'id',          v_period.id,
      'name',        v_period.name,
      'start_date',  v_period.start_date,
      'end_date',    v_period.end_date,
      'status',      v_period.status,
      'is_active',   v_period.is_active
    ),
    'areas', v_areas,
    'activities', v_acts,
    'overall_average', v_total,
    'level', v_level,
    'attendance', jsonb_build_object(
      'asistencias',  v_att.asistidos,
      'ausencias',    v_att.ausencias,
      'tardanzas',    v_att.tardanzas,
      'total',        v_att.total,
      'pct',          v_pct
    ),
    'issued_at', CURRENT_DATE,
    'report', CASE WHEN v_report.id IS NOT NULL THEN
      jsonb_build_object(
        'final_score',      v_report.final_score,
        'level',            v_report.level,
        'teacher_comment',  v_report.teacher_comment,
        'directora_comment',v_report.directora_comment,
        'conducta',         v_report.conducta,
        'fortalezas',       COALESCE(v_report.fortalezas, '{}'),
        'debilidades',      COALESCE(v_report.debilidades, '{}'),
        'generated_at',     v_report.generated_at
      )
    ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_boletin(bigint, bigint) TO authenticated;

-- ── 3. RPC: Guardar notas del boletín (comentario/f.t./deb.) ─
-- Upsert sobre report_cards sin tocar los promedios calculados.
DROP FUNCTION IF EXISTS public.save_boletin_notes(bigint, bigint, text, text[], text[], text, text);
CREATE OR REPLACE FUNCTION public.save_boletin_notes(
  p_student_id      bigint,
  p_period_id       bigint,
  p_teacher_comment text DEFAULT NULL,
  p_fortalezas      text[] DEFAULT NULL,
  p_debilidades     text[] DEFAULT NULL,
  p_observaciones   text DEFAULT NULL,
  p_conducta        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_role         text;
  v_classroom_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_conducta IS NOT NULL AND p_conducta NOT IN ('Excelente','Muy buena','Buena','Regular') THEN
    RETURN jsonb_build_object('error', 'Conducta inválida');
  END IF;

  SELECT classroom_id INTO v_classroom_id
  FROM public.students WHERE id = p_student_id;

  -- Acepta id de academic_periods o de legacy periods
  p_period_id := public.resolve_period_id(p_period_id);

  INSERT INTO public.report_cards (
    student_id, classroom_id, period_id,
    teacher_comment, fortalezas, debilidades, directora_comment, conducta
  )
  VALUES (
    p_student_id, v_classroom_id, p_period_id,
    p_teacher_comment,
    COALESCE(p_fortalezas, '{}'),
    COALESCE(p_debilidades, '{}'),
    p_observaciones,
    p_conducta
  )
  ON CONFLICT (student_id, period_id) DO UPDATE SET
    teacher_comment  = EXCLUDED.teacher_comment,
    fortalezas       = EXCLUDED.fortalezas,
    debilidades      = EXCLUDED.debilidades,
    directora_comment = EXCLUDED.directora_comment,
    conducta         = EXCLUDED.conducta;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_boletin_notes(bigint, bigint, text, text[], text[], text, text) TO authenticated;

-- ── 4. RPC: Editar nombre y descripción de un área (materia) ──
-- La directora puede renombrar un área y asignarle una descripción.
-- subjects.name es UNIQUE por education_level, así el cambio se ve
-- en todas las aulas del nivel (la configuración es global).
DROP FUNCTION IF EXISTS public.update_subject(bigint, text, text);
CREATE OR REPLACE FUNCTION public.update_subject(
  p_subject_id   bigint,
  p_name         text,
  p_description  text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'El nombre del área es requerido');
  END IF;

  UPDATE public.subjects
  SET name        = btrim(p_name),
      description = NULLIF(btrim(COALESCE(p_description, '')), '')
  WHERE id = p_subject_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Área no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_subject(bigint, text, text) TO authenticated;

-- ── 5. RPC: Períodos para calificaciones (academic_periods → legacy) ──
-- period_config/activities/grades FK a legacy "periods". Este RPC devuelve
-- los períodos usando su id de legacy periods y crea automáticamente la fila
-- legacy cuando un academic_period no tiene contraparte (mismo nombre/fechas),
-- igual que close_period().
DROP FUNCTION IF EXISTS public.get_grade_periods();
CREATE OR REPLACE FUNCTION public.get_grade_periods()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role      text;
  v_ap        record;
  v_legacy    bigint;
  v_name      text;
  v_start     date;
  v_end       date;
  v_status    text;
  v_is_active boolean;
  v_result    jsonb := '[]'::jsonb;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL OR v_role NOT IN ('directora','asistente','maestra','admin') THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_ap IN
    SELECT ap.id, ap.name, ap.start_date, ap.end_date, ap.status, ap.is_active, ap.order_index
    FROM public.academic_periods ap
    ORDER BY ap.order_index, ap.start_date
  LOOP
    SELECT p.id INTO v_legacy
    FROM public.periods p
    WHERE p.name = v_ap.name
      AND p.start_date = v_ap.start_date
      AND p.end_date = v_ap.end_date
    ORDER BY p.id
    LIMIT 1;

    IF v_legacy IS NULL THEN
      INSERT INTO public.periods (name, start_date, end_date, status, is_active)
      VALUES (
        v_ap.name, v_ap.start_date, v_ap.end_date,
        CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE 'open' END,
        v_ap.is_active
      )
      RETURNING id INTO v_legacy;
    ELSE
      UPDATE public.periods
      SET status = CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE status END,
          is_active = v_ap.is_active
      WHERE id = v_legacy;
    END IF;

    SELECT status, is_active INTO v_status, v_is_active
    FROM public.periods WHERE id = v_legacy;

    v_result := v_result || jsonb_build_object(
      'id',                 v_legacy,
      'academic_period_id', v_ap.id,
      'name',               v_ap.name,
      'start_date',         v_ap.start_date,
      'end_date',           v_ap.end_date,
      'status',             v_status,
      'is_active',          v_is_active,
      'order_index',        v_ap.order_index
    );
  END LOOP;

  -- Períodos legacy huérfanos (sin contraparte en academic_periods)
  FOR v_legacy IN
    SELECT p.id FROM public.periods p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academic_periods ap
      WHERE ap.name = p.name AND ap.start_date = p.start_date AND ap.end_date = p.end_date
    )
    ORDER BY p.start_date, p.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) e WHERE (e->>'id')::bigint = v_legacy) THEN
      SELECT name, start_date, end_date, status, is_active
        INTO v_name, v_start, v_end, v_status, v_is_active
      FROM public.periods WHERE id = v_legacy;

      v_result := v_result || jsonb_build_object(
        'id', v_legacy, 'academic_period_id', NULL,
        'name', v_name, 'start_date', v_start, 'end_date', v_end,
        'status', v_status, 'is_active', v_is_active, 'order_index', 0
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_grade_periods() TO authenticated;

-- ── 6. RPC: Crear un área (materia) nueva ──
-- Solo directora/admin. El nombre es UNIQUE global en subjects.
DROP FUNCTION IF EXISTS public.insert_subject(text, text, text);
CREATE OR REPLACE FUNCTION public.insert_subject(
  p_name             text,
  p_education_level  text,
  p_description      text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_id   bigint;
BEGIN
  v_role := (SELECT role FROM public.profiles WHERE id = auth.uid());
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error', 'Acceso denegado');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'El nombre del área es requerido');
  END IF;
  IF p_education_level NOT IN ('estancia','preescolar','primaria') THEN
    RETURN jsonb_build_object('error', 'Nivel educativo inválido');
  END IF;

  BEGIN
    INSERT INTO public.subjects (name, education_level, description)
    VALUES (
      btrim(p_name),
      p_education_level,
      NULLIF(btrim(COALESCE(p_description, '')), '')
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'Ya existe un área con ese nombre');
  END;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_subject(text, text, text) TO authenticated;

-- ── 7. RPC: Resolver id de período (academic_periods → legacy) ──
-- period_config, activities, grades y report_cards FK a legacy "periods",
-- mientras el School Engine usa academic_periods. Este helper acepta
-- CUALQUIER id y devuelve el id legacy (creándolo si falta), de modo que
-- todas las funciones de calificaciones funcionen con ambos sistemas.
DROP FUNCTION IF EXISTS public.resolve_period_id(bigint);
CREATE OR REPLACE FUNCTION public.resolve_period_id(p_period_id bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_legacy bigint;
  v_ap     record;
BEGIN
  -- Ya es un id de legacy periods: devolverlo tal cual
  IF EXISTS (SELECT 1 FROM public.periods WHERE id = p_period_id) THEN
    RETURN p_period_id;
  END IF;

  -- No es legacy: si tampoco es un academic_period, devolver el mismo id
  SELECT * INTO v_ap FROM public.academic_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN p_period_id;
  END IF;

  -- Buscar contraparte legacy por nombre + fechas (igual que close_period)
  SELECT p.id INTO v_legacy
  FROM public.periods p
  WHERE p.name = v_ap.name
    AND p.start_date = v_ap.start_date
    AND p.end_date = v_ap.end_date
  ORDER BY p.id
  LIMIT 1;

  IF v_legacy IS NULL THEN
    INSERT INTO public.periods (name, start_date, end_date, status, is_active)
    VALUES (
      v_ap.name, v_ap.start_date, v_ap.end_date,
      CASE WHEN v_ap.status IN ('open','closed') THEN v_ap.status ELSE 'open' END,
      v_ap.is_active
    )
    RETURNING id INTO v_legacy;
  END IF;

  RETURN v_legacy;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_period_id(bigint) TO authenticated;

-- ── 8. get_period_config id-agnóstico ──
CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
  WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_period_config(bigint) TO authenticated;

-- ── 9. get_activities_with_grades id-agnóstico ──
CREATE OR REPLACE FUNCTION public.get_activities_with_grades(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             a.id,
        'title',          a.title,
        'description',    a.description,
        'max_score',      a.max_score,
        'activity_number',a.activity_number,
        'is_mandatory',   a.is_mandatory,
        'config_id',      a.config_id,
        'subject_id',     pc.subject_id,
        'subject_name',   s.name,
        'grade_count',    COALESCE(g.grade_count, 0),
        'graded_count',   COALESCE(g.graded_count, 0)
      )
      ORDER BY s.name, a.activity_number
    ),
    '[]'::jsonb
  )
  FROM public.activities a
  JOIN public.period_config pc ON pc.id = a.config_id
  JOIN public.subjects s ON s.id = pc.subject_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS grade_count,
      COUNT(g.score_v2)::int AS graded_count
    FROM public.grades g
    WHERE g.activity_id = a.id
  ) g ON true
  WHERE pc.period_id = public.resolve_period_id(p_period_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_activities_with_grades(bigint) TO authenticated;

-- ── 10. get_student_grades_v2 id-agnóstico ──
CREATE OR REPLACE FUNCTION public.get_student_grades_v2(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('activity_id',g.activity_id,'score',g.score_v2,
    'subject_name',s.name,'activity_title',a.title,'activity_number',a.activity_number,'comment',g.notes)
    ORDER BY s.name, a.activity_number),'[]')
  FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
  JOIN public.period_config pc ON pc.id = a.config_id JOIN public.subjects s ON s.id = pc.subject_id
  WHERE g.student_id = p_student_id AND pc.period_id = public.resolve_period_id(p_period_id) AND g.score_v2 IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_grades_v2(bigint, bigint) TO authenticated;

-- ── 11. get_student_subject_averages id-agnóstico ──
CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('subject_name',s.name,'average',sa.average,
    'graded_count',sa.graded_count,'method',sa.method) ORDER BY s.name),'[]')
  FROM public.subject_averages sa JOIN public.subjects s ON s.id = sa.subject_id
  WHERE sa.student_id = p_student_id AND sa.period_id = public.resolve_period_id(p_period_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_student_subject_averages(bigint, bigint) TO authenticated;
