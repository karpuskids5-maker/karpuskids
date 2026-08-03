-- ============================================================
-- 🎓 Karpus Kids — Cierre de Período con Cálculo de Promedios
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. RPC: Cerrar período y calcular promedios automáticamente ──────────────
-- Calcula el promedio de cada estudiante del aula basado en sus task_evidences
-- del período, genera/actualiza report_cards, y cierra el período.

CREATE OR REPLACE FUNCTION public.close_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period        periods%ROWTYPE;
  v_user_id       uuid;
  v_role          text;
  v_student       record;
  v_avg           numeric(4,2);
  v_task_avg      numeric(4,2);
  v_formal_avg    numeric(4,2);
  v_level         text;
  v_cards_created int := 0;
  v_cards_updated int := 0;
BEGIN
  -- Verificar permisos
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora', 'admin') THEN
    RETURN jsonb_build_object('error', 'Solo la directora puede cerrar períodos');
  END IF;

  -- Obtener el período
  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Período no encontrado');
  END IF;
  IF v_period.status = 'closed' THEN
    RETURN jsonb_build_object('error', 'El período ya está cerrado');
  END IF;

  -- Calcular promedio por estudiante del aula del período
  FOR v_student IN
    SELECT s.id AS student_id, s.name AS student_name
    FROM public.students s
    WHERE s.classroom_id = v_period.classroom_id
      AND s.is_active = true
  LOOP
    -- Promedio de tareas: basado en task_evidences calificadas del período
    SELECT
      ROUND(AVG(
        CASE
          WHEN te.stars IS NOT NULL AND te.stars > 0 THEN te.stars::numeric
          WHEN te.grade_letter = 'A' THEN 5
          WHEN te.grade_letter = 'B' THEN 4
          WHEN te.grade_letter = 'C' THEN 3
          WHEN te.grade_letter = 'D' THEN 2
          WHEN te.grade_letter = 'E' THEN 1
          ELSE NULL
        END
      ), 2)
    INTO v_task_avg
    FROM public.task_evidences te
    JOIN public.tasks t ON t.id = te.task_id
    WHERE te.student_id = v_student.student_id
      AND t.classroom_id = v_period.classroom_id
      AND te.status = 'graded'
      AND t.created_at BETWEEN v_period.start_date AND v_period.end_date + INTERVAL '1 day';

    -- Promedio formal: basado en grades directas del período
    SELECT ROUND(AVG(g.score), 2)
    INTO v_formal_avg
    FROM public.grades g
    WHERE g.student_id = v_student.student_id
      AND g.period_id = p_period_id;

    -- Promedio final: 60% tareas + 40% formal (si ambos existen)
    IF v_task_avg IS NOT NULL AND v_formal_avg IS NOT NULL THEN
      v_avg := ROUND((v_task_avg * 0.6) + (v_formal_avg * 0.4), 2);
    ELSIF v_task_avg IS NOT NULL THEN
      v_avg := v_task_avg;
    ELSIF v_formal_avg IS NOT NULL THEN
      v_avg := v_formal_avg;
    ELSE
      v_avg := NULL;
    END IF;

    -- Determinar nivel
    v_level := CASE
      WHEN v_avg IS NULL    THEN 'Sin calificar'
      WHEN v_avg >= 4.5     THEN 'Excelente'
      WHEN v_avg >= 3.5     THEN 'Bueno'
      WHEN v_avg >= 2.5     THEN 'En proceso'
      ELSE                       'Requiere apoyo'
    END;

    -- Insertar o actualizar report_card
    INSERT INTO public.report_cards (
      student_id, classroom_id, period_id,
      task_avg, formal_avg, final_score, level,
      created_at
    )
    VALUES (
      v_student.student_id, v_period.classroom_id, p_period_id,
      v_task_avg, v_formal_avg, v_avg, v_level,
      now()
    )
    ON CONFLICT (student_id, period_id) DO UPDATE SET
      task_avg    = EXCLUDED.task_avg,
      formal_avg  = EXCLUDED.formal_avg,
      final_score = EXCLUDED.final_score,
      level       = EXCLUDED.level;

    GET DIAGNOSTICS v_cards_created = ROW_COUNT;
    v_cards_updated := v_cards_updated + 1;
  END LOOP;

  -- Cerrar el período
  UPDATE public.periods
  SET status    = 'closed',
      is_active = false
  WHERE id = p_period_id;

  -- Registrar en auditoría
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id, 'period.closed', jsonb_build_object(
    'period_id',   p_period_id,
    'period_name', v_period.name,
    'cards_generated', v_cards_updated
  ), now());

  RETURN jsonb_build_object(
    'success',          true,
    'period_id',        p_period_id,
    'period_name',      v_period.name,
    'cards_generated',  v_cards_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_period(bigint) TO authenticated;

-- ── 2. Constraint UNIQUE en report_cards (si no existe) ─────────────────────
ALTER TABLE public.report_cards
  ADD CONSTRAINT IF NOT EXISTS report_cards_student_period_unique
  UNIQUE (student_id, period_id);

-- ── 3. RPC: Obtener período activo de un aula ────────────────────────────────
-- Usado por el panel de maestras para verificar si puede editar notas.
CREATE OR REPLACE FUNCTION public.get_active_period(p_classroom_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period periods%ROWTYPE;
BEGIN
  SELECT * INTO v_period
  FROM public.periods
  WHERE classroom_id = p_classroom_id
    AND status = 'open'
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Buscar cualquier período abierto del aula aunque no sea is_active
    SELECT * INTO v_period
    FROM public.periods
    WHERE classroom_id = p_classroom_id
      AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'status', 'no_period');
  END IF;

  RETURN jsonb_build_object(
    'found',      true,
    'id',         v_period.id,
    'name',       v_period.name,
    'status',     v_period.status,
    'is_active',  v_period.is_active,
    'start_date', v_period.start_date,
    'end_date',   v_period.end_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_period(bigint) TO authenticated;

-- ── 4. RLS: Bloquear INSERT/UPDATE en grades si período está cerrado ─────────
-- Política a nivel de DB — no depende del frontend
CREATE OR REPLACE FUNCTION public.is_period_open(p_period_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.periods
    WHERE id = p_period_id AND status = 'open'
  );
$$;

-- Actualizar política de grades para bloquear escritura en períodos cerrados
DROP POLICY IF EXISTS "grades_staff" ON public.grades;
CREATE POLICY "grades_staff" ON public.grades FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND (
      period_id IS NULL  -- grades sin período siempre permitidas
      OR public.is_period_open(period_id)  -- solo si el período está abierto
      OR get_my_role() IN ('directora','admin')  -- directora puede siempre
    )
  );
