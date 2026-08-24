-- ═══════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · SQL OPERATIVO 03/10 — ÍNDICES + RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Continuación del esquema maestro (karpus_schema_completo.sql).
-- Contenido: SECCIÓN 6 índices de rendimiento · SECCIÓN 7 enable RLS · SECCIÓN 8 políticas RLS
-- Origen: líneas 992–1503 del archivo original.
--
-- ⚠ EJECUTAR EN ORDEN: 01 → 10 (Supabase Dashboard → SQL Editor)
--   Cada archivo continúa el esquema del anterior; no saltarse ninguno
--   en una base nueva. En la base existente son idempotentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- SECCIÓN 6: ÍNDICES DE RENDIMIENTO
-- ══════════════════════════════════════════════════════════════

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_search_vector    ON public.profiles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_profiles_role             ON public.profiles (role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_name_lower       ON public.profiles (lower(name));
CREATE INDEX IF NOT EXISTS idx_profiles_email            ON public.profiles (email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_role_deleted     ON public.profiles (role, deleted_at) WHERE deleted_at IS NULL;

-- Students
CREATE INDEX IF NOT EXISTS idx_students_search_vector    ON public.students USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_students_name_lower       ON public.students (lower(name));
CREATE INDEX IF NOT EXISTS idx_students_parent           ON public.students (parent_id);
CREATE INDEX IF NOT EXISTS idx_students_classroom        ON public.students (classroom_id);
CREATE INDEX IF NOT EXISTS idx_students_active_fee       ON public.students (is_active, monthly_fee) WHERE is_active = true AND monthly_fee > 0;
CREATE INDEX IF NOT EXISTS idx_students_parent_active    ON public.students (parent_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_classroom_active ON public.students (classroom_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_students_year             ON public.students (school_year_id) WHERE school_year_id IS NOT NULL;

-- Payments
CREATE INDEX IF NOT EXISTS idx_payments_month_paid       ON public.payments (month_paid);
CREATE INDEX IF NOT EXISTS idx_payments_student_month    ON public.payments (student_id, month_paid);
CREATE INDEX IF NOT EXISTS idx_payments_status           ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_month_status     ON public.payments (month_paid, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_overdue_reminder ON public.payments (status, due_date, last_reminder_sent) WHERE status = 'overdue';
CREATE INDEX IF NOT EXISTS idx_payments_student_status   ON public.payments (student_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_due_date         ON public.payments (due_date) WHERE status IN ('pending','overdue');
CREATE INDEX IF NOT EXISTS idx_payments_due_overdue      ON public.payments (due_date, status) WHERE status IN ('pending','overdue') AND deleted_at IS NULL;

-- Attendance
CREATE INDEX IF NOT EXISTS idx_attendance_classroom_date ON public.attendance (classroom_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date   ON public.attendance (student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date           ON public.attendance (date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_classroom      ON public.attendance (classroom_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date_cls_status ON public.attendance (date, classroom_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_student_status ON public.attendance (student_id, status, date);

-- Door punches
CREATE INDEX IF NOT EXISTS idx_door_punches_date         ON public.door_punches (date);
CREATE INDEX IF NOT EXISTS idx_door_punches_student      ON public.door_punches (student_id, date);
CREATE INDEX IF NOT EXISTS idx_door_punches_staff        ON public.door_punches (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_door_punches_classroom    ON public.door_punches (classroom_id, date) WHERE classroom_id IS NOT NULL;

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation     ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender           ON public.messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver         ON public.messages (receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread           ON public.messages (conversation_id, is_read) WHERE is_read = false;

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_user_read   ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_date   ON public.notifications (user_id, created_at DESC);

-- Posts
CREATE INDEX IF NOT EXISTS idx_posts_created_at          ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_classroom_id        ON public.posts (classroom_id) WHERE classroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_teacher_id          ON public.posts (teacher_id);
CREATE INDEX IF NOT EXISTS idx_posts_period              ON public.posts (period_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_posts_classroom_created   ON public.posts (classroom_id, created_at DESC) WHERE classroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_school_year         ON public.posts (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled   ON public.posts (status, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_is_pinned           ON public.posts (is_pinned) WHERE is_pinned = true;

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_period              ON public.tasks (period_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_tasks_classroom_id        ON public.tasks (classroom_id);
CREATE INDEX IF NOT EXISTS idx_tasks_classroom_date      ON public.tasks (classroom_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_school_year         ON public.tasks (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_evidences_task_id    ON public.task_evidences (task_id);
CREATE INDEX IF NOT EXISTS idx_task_evidences_student_id ON public.task_evidences (student_id);
CREATE INDEX IF NOT EXISTS idx_task_evidences_task_status ON public.task_evidences (task_id, status);
CREATE INDEX IF NOT EXISTS idx_task_evidences_score ON public.task_evidences (task_id, student_id) WHERE score_v2 IS NOT NULL;

-- Grades
CREATE INDEX IF NOT EXISTS idx_grades_period             ON public.grades (period_id, student_id);
CREATE INDEX IF NOT EXISTS idx_grades_student_period     ON public.grades (student_id, period_id);
CREATE INDEX IF NOT EXISTS idx_grades_activity           ON public.grades (activity_id);
CREATE INDEX IF NOT EXISTS idx_grades_school_year        ON public.grades (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grades_teacher            ON public.grades (teacher_id);

-- School years & periods
CREATE INDEX IF NOT EXISTS idx_school_years_status       ON public.school_years (status);
CREATE INDEX IF NOT EXISTS idx_academic_periods_year     ON public.academic_periods (school_year_id);
CREATE INDEX IF NOT EXISTS idx_academic_periods_active   ON public.academic_periods (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_enrollments_year          ON public.enrollments (school_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student       ON public.enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_classroom     ON public.enrollments (classroom_id) WHERE classroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_parent        ON public.enrollments (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_history_student   ON public.student_history (student_id);
CREATE INDEX IF NOT EXISTS idx_student_history_year      ON public.student_history (school_year_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_history_student_year ON public.student_history (student_id, school_year_id);

-- Daily logs
CREATE INDEX IF NOT EXISTS idx_daily_logs_student_date   ON public.daily_logs (student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_logs_classroom_date ON public.daily_logs (classroom_id, date DESC) WHERE classroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_logs_year           ON public.daily_logs (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_logs_events         ON public.daily_logs USING GIN (events);

-- Incidents
CREATE INDEX IF NOT EXISTS idx_incidents_student         ON public.incidents (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_classroom       ON public.incidents (classroom_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_teacher         ON public.incidents (teacher_id);

-- Audit & system
CREATE INDEX IF NOT EXISTS idx_audit_logs_payload        ON public.audit_logs USING GIN (payload jsonb_path_ops) WHERE payload IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_action         ON public.audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action    ON public.audit_logs (user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_payment_id          ON public.audit_logs ((payload->>'payment_id'), created_at DESC) WHERE action LIKE 'payment.%';
CREATE INDEX IF NOT EXISTS idx_system_events_type        ON public.system_events (type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_panel       ON public.system_errors (panel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON public.login_attempts (email, created_at DESC, success);
CREATE INDEX IF NOT EXISTS idx_installments_status       ON public.payment_installments (status, due_date);

-- Period config & activities
CREATE INDEX IF NOT EXISTS idx_period_config_period      ON public.period_config (period_id);
CREATE INDEX IF NOT EXISTS idx_activities_config         ON public.activities (config_id);

-- Reports
CREATE INDEX IF NOT EXISTS idx_reports_target            ON public.reports (target_type, target_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_status            ON public.reports (status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_severity          ON public.reports (severity, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reports_created           ON public.reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter          ON public.reports (reporter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_report_history_report     ON public.report_history (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_attachments_report ON public.report_attachments (report_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_report_actions_report     ON public.report_actions (report_id, status);
CREATE INDEX IF NOT EXISTS idx_report_actions_assigned   ON public.report_actions (assigned_to, status);

-- Conversations
CREATE INDEX IF NOT EXISTS idx_conversations_updated     ON public.conversations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user    ON public.conversation_participants (user_id);

-- Event schedule
CREATE INDEX IF NOT EXISTS idx_event_schedule_classroom  ON public.classroom_event_schedule (classroom_id);
CREATE INDEX IF NOT EXISTS idx_event_schedule_active     ON public.classroom_event_schedule (is_active);
CREATE INDEX IF NOT EXISTS idx_event_schedule_category   ON public.classroom_event_schedule (category);
CREATE INDEX IF NOT EXISTS idx_timeline_log_cls_date     ON public.timeline_event_log (classroom_id, created_at);

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 7: ROW LEVEL SECURITY (ENABLE)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidences            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_gallery         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_chat            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periods                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_cards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.door_punches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_years              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_averages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_attachments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_actions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_event_schedule  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_event_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms_acceptance          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_snapshots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_errors             ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 8: POLÍTICAS RLS
-- ══════════════════════════════════════════════════════════════

-- ── PROFILES ──
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND (auth.uid() = id OR get_my_role() IN ('directora','asistente','admin'))
);
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (
  get_my_role() IN ('directora','admin')
);
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (
  deleted_at IS NULL AND (auth.uid() = id OR get_my_role() IN ('directora','admin'))
);
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE USING (
  get_my_role() IN ('directora','admin')
);

-- ── CLASSROOMS ──
DROP POLICY IF EXISTS "classrooms_all" ON public.classrooms;
CREATE POLICY "classrooms_all" ON public.classrooms FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ── STUDENTS ──
DROP POLICY IF EXISTS "students_staff" ON public.students;
CREATE POLICY "students_staff" ON public.students FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "students_parent" ON public.students;
CREATE POLICY "students_parent" ON public.students FOR SELECT
  USING (parent_id = auth.uid() AND deleted_at IS NULL);

-- ── ATTENDANCE ──
DROP POLICY IF EXISTS "attendance_staff" ON public.attendance;
CREATE POLICY "attendance_staff" ON public.attendance FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "attendance_parent" ON public.attendance;
CREATE POLICY "attendance_parent" ON public.attendance FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = attendance.student_id AND s.parent_id = auth.uid()));

-- ── TASKS ──
DROP POLICY IF EXISTS "tasks_staff" ON public.tasks;
CREATE POLICY "tasks_staff" ON public.tasks FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "tasks_parent" ON public.tasks;
CREATE POLICY "tasks_parent" ON public.tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.classroom_id = tasks.classroom_id AND s.parent_id = auth.uid()));

-- ── TASK EVIDENCES ──
DROP POLICY IF EXISTS "evidences_all" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_staff" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_teacher" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_parent_insert" ON public.task_evidences;
DROP POLICY IF EXISTS "evidences_parent_select" ON public.task_evidences;

CREATE POLICY "evidences_staff" ON public.task_evidences FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND is_classroom_accessible(
      (SELECT t.classroom_id FROM public.tasks t WHERE t.id = task_evidences.task_id)
    )
  );

CREATE POLICY "evidences_parent_select" ON public.task_evidences FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = task_evidences.student_id AND s.parent_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tasks t
                 JOIN public.students st ON st.classroom_id = t.classroom_id
                 WHERE t.id = task_evidences.task_id AND st.parent_id = auth.uid())
    )
  );

CREATE POLICY "evidences_parent_insert" ON public.task_evidences FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = task_evidences.student_id AND s.parent_id = auth.uid())
  );

-- ── POSTS ──
DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts FOR INSERT WITH CHECK (
  auth.uid() = teacher_id AND get_my_role() IN ('directora','asistente','maestra','admin')
);
DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts FOR UPDATE
  USING (auth.uid() = teacher_id OR get_my_role() IN ('directora','admin'));
DROP POLICY IF EXISTS "posts_delete" ON public.posts;
CREATE POLICY "posts_delete" ON public.posts FOR DELETE
  USING (auth.uid() = teacher_id OR get_my_role() IN ('directora','admin'));

-- ── COMMENTS / LIKES ──
DROP POLICY IF EXISTS "comments_all" ON public.comments;
CREATE POLICY "comments_all" ON public.comments FOR ALL USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "likes_all" ON public.likes;
CREATE POLICY "likes_all" ON public.likes FOR ALL USING (auth.uid() IS NOT NULL);

-- ── MESSAGES / CONVERSATIONS ──
DROP POLICY IF EXISTS "conversations_all" ON public.conversations;
CREATE POLICY "conversations_all" ON public.conversations FOR ALL USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "conv_participants_all" ON public.conversation_participants;
CREATE POLICY "conv_participants_all" ON public.conversation_participants FOR ALL USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "messages_all" ON public.messages;
CREATE POLICY "messages_all" ON public.messages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = messages.conversation_id AND cp.user_id = auth.uid()));

-- ── NOTIFICATIONS ──
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own" ON public.notifications FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "notifications_staff_insert" ON public.notifications;
CREATE POLICY "notifications_staff_insert" ON public.notifications FOR INSERT
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') OR user_id = auth.uid());

-- ── PAYMENTS ──
DROP POLICY IF EXISTS "payments_staff" ON public.payments;
CREATE POLICY "payments_staff" ON public.payments FOR ALL
  USING (get_my_role() IN ('directora','asistente','admin'));
DROP POLICY IF EXISTS "payments_parent" ON public.payments;
CREATE POLICY "payments_parent" ON public.payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = payments.student_id AND s.parent_id = auth.uid()));
DROP POLICY IF EXISTS "payments_parent_upload" ON public.payments;
CREATE POLICY "payments_parent_upload" ON public.payments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = payments.student_id AND s.parent_id = auth.uid()))
  WITH CHECK (status IN ('pending','overdue','review'));

-- ── PAYMENT AUDIT LOG ──
DROP POLICY IF EXISTS "audit_log_staff" ON public.payment_audit_log;
CREATE POLICY "audit_log_staff" ON public.payment_audit_log FOR SELECT
  USING (get_my_role() IN ('directora','asistente','admin'));

-- is_period_open (definida antes de las políticas que la usan)
CREATE OR REPLACE FUNCTION public.is_period_open(p_period_id bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.periods WHERE id = p_period_id AND status = 'open');
$$;
GRANT EXECUTE ON FUNCTION public.is_period_open(bigint) TO authenticated;

-- ── GRADES ──
DROP POLICY IF EXISTS "grades_staff" ON public.grades;
CREATE POLICY "grades_staff" ON public.grades FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND (period_id IS NULL OR public.is_period_open(period_id) OR get_my_role() IN ('directora','admin'))
  );
DROP POLICY IF EXISTS "grades_parent" ON public.grades;
CREATE POLICY "grades_parent" ON public.grades FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = grades.student_id AND s.parent_id = auth.uid()));

-- ── PERIODS ──
DROP POLICY IF EXISTS "periods_staff" ON public.periods;
CREATE POLICY "periods_staff" ON public.periods FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "periods_parent" ON public.periods;
CREATE POLICY "periods_parent" ON public.periods FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── INCIDENTS ──
DROP POLICY IF EXISTS "incidents_staff" ON public.incidents;
CREATE POLICY "incidents_staff" ON public.incidents FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "incidents_parent" ON public.incidents;
CREATE POLICY "incidents_parent" ON public.incidents FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = incidents.student_id AND s.parent_id = auth.uid()));

-- ── DAILY LOGS ──
DROP POLICY IF EXISTS "daily_logs_staff" ON public.daily_logs;
CREATE POLICY "daily_logs_staff" ON public.daily_logs FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "daily_logs_parent" ON public.daily_logs;
CREATE POLICY "daily_logs_parent" ON public.daily_logs FOR SELECT
  USING (status = 'published' AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = daily_logs.student_id AND s.parent_id = auth.uid()));

-- ── DOOR PUNCHES ──
DROP POLICY IF EXISTS "punches_staff_all" ON public.door_punches;
CREATE POLICY "punches_staff_all" ON public.door_punches FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "punches_parent_read" ON public.door_punches;
CREATE POLICY "punches_parent_read" ON public.door_punches FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = door_punches.student_id AND s.parent_id = auth.uid()));

-- ── GALLERY / CLASSROOM CHAT ──
DROP POLICY IF EXISTS "gallery_all" ON public.classroom_gallery;
CREATE POLICY "gallery_all" ON public.classroom_gallery FOR ALL USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "classroom_chat_all" ON public.classroom_chat;
CREATE POLICY "classroom_chat_all" ON public.classroom_chat FOR ALL USING (auth.uid() IS NOT NULL);

-- ── REPORT CARDS ──
DROP POLICY IF EXISTS "report_cards_staff" ON public.report_cards;
CREATE POLICY "report_cards_staff" ON public.report_cards FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "report_cards_parent" ON public.report_cards;
CREATE POLICY "report_cards_parent" ON public.report_cards FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = report_cards.student_id AND s.parent_id = auth.uid()));

-- ── INQUIRIES ──
DROP POLICY IF EXISTS "inquiries_parent" ON public.inquiries;
CREATE POLICY "inquiries_parent" ON public.inquiries FOR ALL USING (parent_id = auth.uid());
DROP POLICY IF EXISTS "inquiries_staff" ON public.inquiries;
CREATE POLICY "inquiries_staff" ON public.inquiries FOR ALL
  USING (get_my_role() IN ('directora','asistente','admin'));

-- ── AUDIT LOGS ──
DROP POLICY IF EXISTS "audit_logs_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_admin" ON public.audit_logs FOR ALL
  USING (get_my_role() IN ('directora','admin'));
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- ── SCHOOL YEARS ──
DROP POLICY IF EXISTS "school_years_staff" ON public.school_years;
CREATE POLICY "school_years_staff" ON public.school_years FOR ALL
  USING (get_my_role() IN ('directora','admin'))
  WITH CHECK (get_my_role() IN ('directora','admin'));
DROP POLICY IF EXISTS "school_years_read" ON public.school_years;
CREATE POLICY "school_years_read" ON public.school_years FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── ACADEMIC PERIODS ──
DROP POLICY IF EXISTS "academic_periods_staff" ON public.academic_periods;
CREATE POLICY "academic_periods_staff" ON public.academic_periods FOR ALL
  USING (get_my_role() IN ('directora','maestra','asistente','admin'));
DROP POLICY IF EXISTS "academic_periods_parent" ON public.academic_periods;
CREATE POLICY "academic_periods_parent" ON public.academic_periods FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── STUDENT HISTORY ──
DROP POLICY IF EXISTS "student_history_staff" ON public.student_history;
CREATE POLICY "student_history_staff" ON public.student_history FOR ALL
  USING (get_my_role() IN ('directora','admin'));
DROP POLICY IF EXISTS "student_history_teacher" ON public.student_history;
CREATE POLICY "student_history_teacher" ON public.student_history FOR SELECT
  USING (get_my_role() IN ('maestra','asistente'));
DROP POLICY IF EXISTS "student_history_parent" ON public.student_history;
CREATE POLICY "student_history_parent" ON public.student_history FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE parent_id = auth.uid()));

-- ── ENROLLMENTS ──
DROP POLICY IF EXISTS "enrollments_staff" ON public.enrollments;
CREATE POLICY "enrollments_staff" ON public.enrollments FOR ALL
  USING (get_my_role() IN ('directora','asistente','admin'));
DROP POLICY IF EXISTS "enrollments_parent" ON public.enrollments;
CREATE POLICY "enrollments_parent" ON public.enrollments FOR SELECT USING (parent_id = auth.uid());

-- ── SUBJECTS / PERIOD_CONFIG / ACTIVITIES ──
DROP POLICY IF EXISTS "subjects_auth" ON public.subjects;
CREATE POLICY "subjects_auth" ON public.subjects FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "period_config_staff" ON public.period_config;
CREATE POLICY "period_config_staff" ON public.period_config FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "activities_staff" ON public.activities;
CREATE POLICY "activities_staff" ON public.activities FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "subject_averages_staff" ON public.subject_averages;
CREATE POLICY "subject_averages_staff" ON public.subject_averages FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "subject_averages_parent" ON public.subject_averages;
CREATE POLICY "subject_averages_parent" ON public.subject_averages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students st WHERE st.id = subject_averages.student_id AND st.parent_id = auth.uid()));

-- ── REPORTS ──
DROP POLICY IF EXISTS "reports_select" ON public.reports;
CREATE POLICY "reports_select" ON public.reports FOR SELECT USING (
  deleted_at IS NULL AND (get_my_role() IN ('directora','admin') OR target_id = auth.uid() OR reporter_id = auth.uid())
);
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (get_my_role() IN ('directora','admin'));
DROP POLICY IF EXISTS "reports_update" ON public.reports;
CREATE POLICY "reports_update" ON public.reports FOR UPDATE USING (deleted_at IS NULL AND get_my_role() IN ('directora','admin'));

-- ── LOGIN ATTEMPTS ──
DROP POLICY IF EXISTS "login_attempts_insert" ON public.login_attempts;
CREATE POLICY "login_attempts_insert" ON public.login_attempts FOR INSERT WITH CHECK (true);

-- ── STAFF PERMITS ──
DROP POLICY IF EXISTS "permits_staff" ON public.staff_permits;
CREATE POLICY "permits_staff" ON public.staff_permits FOR ALL
  USING (get_my_role() IN ('directora','admin') OR staff_id = auth.uid());

-- ── CLASSROOM EVENT SCHEDULE ──
DROP POLICY IF EXISTS "event_schedule_staff" ON public.classroom_event_schedule;
CREATE POLICY "event_schedule_staff" ON public.classroom_event_schedule FOR ALL
  USING (get_my_role() IN ('directora','maestra','asistente','admin') OR
    classroom_id IN (SELECT id FROM public.classrooms WHERE teacher_id = auth.uid()));
DROP POLICY IF EXISTS "event_schedule_parent" ON public.classroom_event_schedule;
CREATE POLICY "event_schedule_parent" ON public.classroom_event_schedule FOR SELECT
  USING (classroom_id IN (SELECT classroom_id FROM public.students WHERE parent_id = auth.uid()));

-- ── TIMELINE EVENT LOG ──
DROP POLICY IF EXISTS "timeline_log_staff" ON public.timeline_event_log;
CREATE POLICY "timeline_log_staff" ON public.timeline_event_log FOR ALL
  USING (get_my_role() IN ('directora','maestra','asistente','admin') OR
    classroom_id IN (SELECT id FROM public.classrooms WHERE teacher_id = auth.uid()));
DROP POLICY IF EXISTS "timeline_log_parent" ON public.timeline_event_log;
CREATE POLICY "timeline_log_parent" ON public.timeline_event_log FOR SELECT
  USING (classroom_id IN (SELECT classroom_id FROM public.students WHERE parent_id = auth.uid()));

-- ── MEETINGS ──
DROP POLICY IF EXISTS "meetings_staff" ON public.meetings;
CREATE POLICY "meetings_staff" ON public.meetings FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));
DROP POLICY IF EXISTS "meetings_parent" ON public.meetings;
CREATE POLICY "meetings_parent" ON public.meetings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students WHERE classroom_id = meetings.target_id::bigint AND parent_id = auth.uid()));

-- ── MEETING ATTENDANCE ──
DROP POLICY IF EXISTS "meeting_att_all" ON public.meeting_attendance;
CREATE POLICY "meeting_att_all" ON public.meeting_attendance FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ══════════════════════════════════════════════════════════════
