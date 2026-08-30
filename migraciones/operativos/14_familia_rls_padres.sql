-- ============================================================================
-- KARPUS KIDS · MIGRACIÓN 14 — RLS DE FAMILIA (VISIBILIDAD DE HERMANOS)
-- ============================================================================
-- Objetivo (informe pagos.md · Sección 2 / panel de padres):
--   Corregir que los hermanos NO compartan parent_id: un padre debe poder ver
--   (seleccionar) y gestionar la data de TODOS sus hijos (pagos, asistencia,
--   calificaciones, rutina, evidencias, reportes, cargos...), aunque tengan
--   distinto parent_id, SIEMPRE que:
--     a) compartan email/cédula de tutor (p1/p2), o
--     b) estén vinculados por sibling_id (en cualquier dirección).
--
--   El motivo: las políticas RLS de padres estaban fijadas a
--   `parent_id = auth.uid()`, por lo que PostgREST devolvía CERO filas para
--   los hermanos con parent_id distinto/NULO → los chips de cambio de
--   estudiante no aparecían ni se cargaba su data.
--
--   La migración crea el helper `is_family_member(student_id)` (SECURITY
--   DEFINER) y actualiza TODAS las políticas de lectura/escritura de padres
--   para usarlo. Es 100% re-ejecutable (idempotente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: ¿el padre autenticado es miembro de la familia de este estudiante?
--    Familia = comparte parent_id, o email/cédula de tutor (p1/p2), o
--    vínculo sibling_id (directo en cualquier dirección).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_family_member(p_student_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students target
    WHERE target.id = p_student_id
      AND target.deleted_at IS NULL
      AND (
        -- 1) Tutor directo
        target.parent_id = auth.uid()

        -- 2) Comparte email/cédula de tutor con un estudiante del padre
        OR EXISTS (
          SELECT 1 FROM public.students mine
          WHERE mine.deleted_at IS NULL
            AND mine.parent_id = auth.uid()
            AND (
              ( lower(trim(coalesce(mine.p1_email,''))) <> ''
                AND lower(trim(coalesce(mine.p1_email,''))) IN
                    (lower(trim(coalesce(target.p1_email,''))), lower(trim(coalesce(target.p2_email,'')))) )
              OR ( lower(trim(coalesce(mine.p2_email,''))) <> ''
                   AND lower(trim(coalesce(mine.p2_email,''))) IN
                       (lower(trim(coalesce(target.p1_email,''))), lower(trim(coalesce(target.p2_email,'')))) )
              OR ( regexp_replace(coalesce(mine.p1_cedula,''),'\D','','g') <> ''
                   AND regexp_replace(coalesce(mine.p1_cedula,''),'\D','','g') IN
                       (regexp_replace(coalesce(target.p1_cedula,''),'\D','','g'),
                        regexp_replace(coalesce(target.p2_cedula,''),'\D','','g')) )
              OR ( regexp_replace(coalesce(mine.p2_cedula,''),'\D','','g') <> ''
                   AND regexp_replace(coalesce(mine.p2_cedula,''),'\D','','g') IN
                       (regexp_replace(coalesce(target.p1_cedula,''),'\D','','g'),
                        regexp_replace(coalesce(target.p2_cedula,''),'\D','','g')) )
            )
        )

        -- 3) Vínculo directo por sibling_id (cualquier dirección)
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.deleted_at IS NULL
            AND s.parent_id = auth.uid()
            AND (s.sibling_id = target.id OR (target.sibling_id IS NOT NULL AND target.sibling_id = s.id))
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_family_member(bigint) TO authenticated;

COMMENT ON FUNCTION public.is_family_member(bigint) IS
  'Devuelve true si el padre autenticado pertenece a la familia del estudiante (parent_id, email/cédula de tutor o sibling_id).';

-- ---------------------------------------------------------------------------
-- 2. is_classroom_accessible: el padre también accede a aulas de sus hermanos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_classroom_accessible(p_classroom_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (SELECT 1 FROM public.classrooms c WHERE c.id = p_classroom_id AND c.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.classroom_id = p_classroom_id
                 AND s.deleted_at IS NULL
                 AND public.is_family_member(s.id));
$$;

-- ---------------------------------------------------------------------------
-- 3. Políticas de padres actualizadas (familia-aware), todas idempotentes.
--    "DROP IF EXISTS" + CREATE evita conflictos con re-ejecuciones.
-- ---------------------------------------------------------------------------

-- ── STUDENTS ──
DROP POLICY IF EXISTS "students_parent" ON public.students;
CREATE POLICY "students_parent" ON public.students FOR SELECT
  USING (public.is_family_member(id) AND deleted_at IS NULL);

-- ── ATTENDANCE ──
DROP POLICY IF EXISTS "attendance_parent" ON public.attendance;
CREATE POLICY "attendance_parent" ON public.attendance FOR SELECT
  USING (public.is_family_member(attendance.student_id));

-- ── TASKS ──
DROP POLICY IF EXISTS "tasks_parent" ON public.tasks;
CREATE POLICY "tasks_parent" ON public.tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s
                 WHERE s.classroom_id = tasks.classroom_id
                   AND public.is_family_member(s.id)));

-- ── TASK EVIDENCES ──
DROP POLICY IF EXISTS "evidences_parent_select" ON public.task_evidences;
CREATE POLICY "evidences_parent_select" ON public.task_evidences FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.is_family_member(task_evidences.student_id)
      OR EXISTS (SELECT 1 FROM public.tasks t
                 JOIN public.students st ON st.classroom_id = t.classroom_id
                 WHERE t.id = task_evidences.task_id AND public.is_family_member(st.id))
    )
  );

DROP POLICY IF EXISTS "evidences_parent_insert" ON public.task_evidences;
CREATE POLICY "evidences_parent_insert" ON public.task_evidences FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_family_member(task_evidences.student_id)
  );

-- ── PAYMENTS ──
DROP POLICY IF EXISTS "payments_parent" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_see_own" ON public.payments;
CREATE POLICY "payments_parent_see_own" ON public.payments FOR SELECT
  USING (public.is_family_member(payments.student_id));

DROP POLICY IF EXISTS "payments_parent_upload" ON public.payments;
DROP POLICY IF EXISTS "payments_parent_can_update_own" ON public.payments;
CREATE POLICY "payments_parent_can_update_own" ON public.payments FOR UPDATE
  USING (public.is_family_member(payments.student_id))
  WITH CHECK (public.is_family_member(payments.student_id) AND status IN ('pending','overdue','review'));

-- ── GRADES ──
DROP POLICY IF EXISTS "grades_parent" ON public.grades;
CREATE POLICY "grades_parent" ON public.grades FOR SELECT
  USING (public.is_family_member(grades.student_id));

-- ── INCIDENTS ──
DROP POLICY IF EXISTS "incidents_parent" ON public.incidents;
CREATE POLICY "incidents_parent" ON public.incidents FOR SELECT
  USING (public.is_family_member(incidents.student_id));

-- ── DAILY LOGS ──
DROP POLICY IF EXISTS "daily_logs_parent" ON public.daily_logs;
CREATE POLICY "daily_logs_parent" ON public.daily_logs FOR SELECT
  USING (status = 'published' AND public.is_family_member(daily_logs.student_id));

-- ── DOOR PUNCHES ──
DROP POLICY IF EXISTS "punches_parent_read" ON public.door_punches;
CREATE POLICY "punches_parent_read" ON public.door_punches FOR SELECT
  USING (public.is_family_member(door_punches.student_id));

-- ── REPORT CARDS ──
DROP POLICY IF EXISTS "report_cards_parent" ON public.report_cards;
CREATE POLICY "report_cards_parent" ON public.report_cards FOR SELECT
  USING (public.is_family_member(report_cards.student_id));

-- ── STUDENT HISTORY ──
DROP POLICY IF EXISTS "student_history_parent" ON public.student_history;
CREATE POLICY "student_history_parent" ON public.student_history FOR SELECT
  USING (public.is_family_member(student_history.student_id));

-- ── SUBJECT AVERAGES ──
DROP POLICY IF EXISTS "subject_averages_parent" ON public.subject_averages;
CREATE POLICY "subject_averages_parent" ON public.subject_averages FOR SELECT
  USING (public.is_family_member(subject_averages.student_id));

-- ── STUDENT CHARGES ──
DROP POLICY IF EXISTS "charges_parent" ON public.student_charges;
CREATE POLICY "charges_parent" ON public.student_charges FOR SELECT
  USING (public.is_family_member(student_charges.student_id));

-- ── MEETINGS ──
DROP POLICY IF EXISTS "meetings_parent" ON public.meetings;
CREATE POLICY "meetings_parent" ON public.meetings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students
                 WHERE classroom_id = meetings.target_id::bigint AND public.is_family_member(id)));

-- ============================================================================
-- FIN MIGRACIÓN 14
-- ============================================================================
