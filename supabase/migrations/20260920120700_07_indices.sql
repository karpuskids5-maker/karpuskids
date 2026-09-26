-- ==========================================================================
-- KARPUS KIDS / MIGRACION CONSOLIDADA 7/10 - INDICES
--
-- Generada por auditoria de los 36 archivos de migraciones/operativos/ y
-- los 8 de supabase/migrations/ (44 fuentes en total). Esta migracion y las 9
-- restantes son las unicas que se conservan: las 44 fuentes originales se
-- eliminaron del repositorio tras consolidar y corregir sus defectos.
--
-- IDEMPOTENTE: se puede aplicar sobre la base ya desplegada sin perder datos.
-- Ejecutar en orden 01 -> 10 (ver README de migraciones).
-- ==========================================================================

-- 144 indices sobre tablas vivas.
-- Los indices de payment_plans / payment_installments se excluyen porque esas
-- tablas se eliminan en la migracion 10.

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_years_one_active
  ON public.school_years (status)
  WHERE status IN ('active','enrollment','reenrollment');

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_matricula
  ON public.students(matricula) WHERE matricula IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_student_month
  ON public.payments(student_id, month_paid)
  WHERE month_paid IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_search_vector    ON public.profiles USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_profiles_role             ON public.profiles (role) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_name_lower       ON public.profiles (lower(name));

CREATE INDEX IF NOT EXISTS idx_profiles_email            ON public.profiles (email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role_deleted     ON public.profiles (role, deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_search_vector    ON public.students USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_students_name_lower       ON public.students (lower(name));

CREATE INDEX IF NOT EXISTS idx_students_parent           ON public.students (parent_id);

CREATE INDEX IF NOT EXISTS idx_students_classroom        ON public.students (classroom_id);

CREATE INDEX IF NOT EXISTS idx_students_active_fee       ON public.students (is_active, monthly_fee) WHERE is_active = true AND monthly_fee > 0;

CREATE INDEX IF NOT EXISTS idx_students_parent_active    ON public.students (parent_id, is_active) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_classroom_active ON public.students (classroom_id, is_active) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_year             ON public.students (school_year_id) WHERE school_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_month_paid ON public.payments(month_paid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_student_month    ON public.payments (student_id, month_paid);

CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_month_status     ON public.payments (month_paid, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_overdue_reminder ON public.payments (status, due_date, last_reminder_sent) WHERE status = 'overdue';

CREATE INDEX IF NOT EXISTS idx_payments_student_status   ON public.payments (student_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_due_date ON public.payments(due_date)
  WHERE deleted_at IS NULL AND status IN ('pending', 'overdue');

CREATE INDEX IF NOT EXISTS idx_payments_due_overdue      ON public.payments (due_date, status) WHERE status IN ('pending','overdue') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_classroom_date ON public.attendance (classroom_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_student_date   ON public.attendance (student_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_date           ON public.attendance (date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_classroom      ON public.attendance (classroom_id);

CREATE INDEX IF NOT EXISTS idx_attendance_date_cls_status ON public.attendance (date, classroom_id, status);

CREATE INDEX IF NOT EXISTS idx_attendance_student_status ON public.attendance (student_id, status, date);

CREATE INDEX IF NOT EXISTS idx_door_punches_date    ON public.door_punches(date);

CREATE INDEX IF NOT EXISTS idx_door_punches_student ON public.door_punches(student_id, date);

CREATE INDEX IF NOT EXISTS idx_door_punches_staff   ON public.door_punches(staff_id, date);

CREATE INDEX IF NOT EXISTS idx_door_punches_classroom    ON public.door_punches (classroom_id, date) WHERE classroom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation     ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender           ON public.messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_receiver         ON public.messages (receiver_id);

CREATE INDEX IF NOT EXISTS idx_messages_unread           ON public.messages (conversation_id, is_read) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, is_read) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_read   ON public.notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_date   ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_created_at          ON public.posts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_classroom_id        ON public.posts (classroom_id) WHERE classroom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_teacher_id          ON public.posts (teacher_id);

CREATE INDEX IF NOT EXISTS idx_posts_period              ON public.posts (period_id, classroom_id);

CREATE INDEX IF NOT EXISTS idx_posts_classroom_created   ON public.posts (classroom_id, created_at DESC) WHERE classroom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_school_year         ON public.posts (school_year_id) WHERE school_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON public.posts(status, scheduled_at)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_posts_is_pinned ON public.posts(is_pinned) WHERE is_pinned = true;

CREATE INDEX IF NOT EXISTS idx_tasks_period              ON public.tasks (period_id, classroom_id);

CREATE INDEX IF NOT EXISTS idx_tasks_classroom_id        ON public.tasks (classroom_id);

CREATE INDEX IF NOT EXISTS idx_tasks_classroom_date      ON public.tasks (classroom_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_school_year         ON public.tasks (school_year_id) WHERE school_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_evidences_task_id    ON public.task_evidences (task_id);

CREATE INDEX IF NOT EXISTS idx_task_evidences_student_id ON public.task_evidences (student_id);

CREATE INDEX IF NOT EXISTS idx_task_evidences_task_status ON public.task_evidences (task_id, status);

CREATE INDEX IF NOT EXISTS idx_task_evidences_score ON public.task_evidences (task_id, student_id) WHERE score_v2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grades_period             ON public.grades (period_id, student_id);

CREATE INDEX IF NOT EXISTS idx_grades_student_period     ON public.grades (student_id, period_id);

CREATE INDEX IF NOT EXISTS idx_grades_activity           ON public.grades (activity_id);

CREATE INDEX IF NOT EXISTS idx_grades_school_year        ON public.grades (school_year_id) WHERE school_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grades_teacher            ON public.grades (teacher_id);

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

CREATE INDEX IF NOT EXISTS idx_daily_logs_student_date   ON public.daily_logs (student_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_logs_classroom_date ON public.daily_logs (classroom_id, date DESC) WHERE classroom_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_year           ON public.daily_logs (school_year_id) WHERE school_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_logs_events         ON public.daily_logs USING GIN (events);

CREATE INDEX IF NOT EXISTS idx_incidents_student         ON public.incidents (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_classroom       ON public.incidents (classroom_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_teacher         ON public.incidents (teacher_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_payload        ON public.audit_logs USING GIN (payload jsonb_path_ops) WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action         ON public.audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action    ON public.audit_logs (user_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_payment_id          ON public.audit_logs ((payload->>'payment_id'), created_at DESC) WHERE action LIKE 'payment.%';

CREATE INDEX IF NOT EXISTS idx_system_events_type        ON public.system_events (type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_errors_panel       ON public.system_errors (panel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON public.login_attempts (email, created_at DESC, success);

CREATE INDEX IF NOT EXISTS idx_period_config_period      ON public.period_config (period_id);

CREATE INDEX IF NOT EXISTS idx_activities_config         ON public.activities (config_id);

CREATE INDEX IF NOT EXISTS idx_reports_target            ON public.reports (target_type, target_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_reports_status            ON public.reports (status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_reports_severity          ON public.reports (severity, deleted_at);

CREATE INDEX IF NOT EXISTS idx_reports_created           ON public.reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reporter          ON public.reports (reporter_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_report_history_report     ON public.report_history (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_attachments_report ON public.report_attachments (report_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_report_actions_report     ON public.report_actions (report_id, status);

CREATE INDEX IF NOT EXISTS idx_report_actions_assigned   ON public.report_actions (assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_conversations_updated     ON public.conversations (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user    ON public.conversation_participants (user_id);

CREATE INDEX IF NOT EXISTS idx_event_schedule_classroom  ON public.classroom_event_schedule (classroom_id);

CREATE INDEX IF NOT EXISTS idx_event_schedule_active     ON public.classroom_event_schedule (is_active);

CREATE INDEX IF NOT EXISTS idx_event_schedule_category   ON public.classroom_event_schedule (category);

CREATE INDEX IF NOT EXISTS idx_timeline_log_cls_date     ON public.timeline_event_log (classroom_id, created_at);

CREATE INDEX IF NOT EXISTS idx_prereg_status        ON public.student_preregistrations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prereg_email         ON public.student_preregistrations (contact_email) WHERE contact_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prereg_converted     ON public.student_preregistrations (converted_student_id) WHERE converted_student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_charges_student ON public.student_charges (student_id, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_student_charges_status  ON public.student_charges (status) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments(student_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_config_id ON public.tasks (config_id);

CREATE INDEX IF NOT EXISTS idx_subjects_classroom ON public.subjects (classroom_id);

CREATE INDEX IF NOT EXISTS idx_period_config_classroom ON public.period_config (classroom_id);

CREATE INDEX IF NOT EXISTS idx_store_products_category  ON store_products(category_id);

CREATE INDEX IF NOT EXISTS idx_store_products_active    ON store_products(is_active);

CREATE INDEX IF NOT EXISTS idx_store_orders_parent      ON store_orders(parent_id);

CREATE INDEX IF NOT EXISTS idx_store_orders_student     ON store_orders(student_id);

CREATE INDEX IF NOT EXISTS idx_store_orders_status      ON store_orders(status);

CREATE INDEX IF NOT EXISTS idx_store_order_items_order  ON store_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_store_inventory_product  ON store_inventory(product_id);

CREATE INDEX IF NOT EXISTS idx_store_sizes_product ON store_product_sizes(product_id);

CREATE INDEX IF NOT EXISTS idx_likes_post_reaction ON public.likes(post_id, reaction_type);

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages(reply_to) WHERE reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_classroom ON public.audit_logs (classroom_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wall_notifications_user_date
  ON public.wall_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_students_sibling_id ON public.students(sibling_id)
  WHERE sibling_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_codes_parent ON public.referral_codes (parent_id);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code     ON public.referral_codes (code);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_parent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_status   ON public.referrals (status)
  WHERE status IN ('invited','registered','visited');

CREATE INDEX IF NOT EXISTS idx_referral_rewards_parent  ON public.referral_rewards (parent_id, is_used);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_active  ON public.referral_rewards (parent_id)
  WHERE is_used = false;

CREATE INDEX IF NOT EXISTS idx_prereg_referral ON public.student_preregistrations (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_donation_campaigns_active
  ON public.donation_campaigns (is_active);

CREATE INDEX IF NOT EXISTS idx_donations_campaign
  ON public.donations (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_donations_status
  ON public.donations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_donations_email
  ON public.donations (donor_email);

CREATE INDEX IF NOT EXISTS idx_donations_created
  ON public.donations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recovery_requests_email_time
  ON public.recovery_requests (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_donations_frequency
  ON public.donations (frequency, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_thumbnail_urls ON posts USING GIN (thumbnail_urls);

-- OMITIDOS (tabla eliminada en la migracion 10): payment_installments
