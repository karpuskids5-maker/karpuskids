-- ==========================================================================
-- KARPUS KIDS / MIGRACION CONSOLIDADA 9/10 - RLS Y POLITICAS
--
-- Generada por auditoria de los 36 archivos de migraciones/operativos/ y
-- los 8 de supabase/migrations/ (44 fuentes en total). Esta migracion y las 9
-- restantes son las unicas que se conservan: las 44 fuentes originales se
-- eliminaron del repositorio tras consolidar y corregir sus defectos.
--
-- IDEMPOTENTE: se puede aplicar sobre la base ya desplegada sin perder datos.
-- Ejecutar en orden 01 -> 10 (ver README de migraciones).
-- ==========================================================================

-- 67 tablas con RLS habilitado y 138 politicas.
-- Cada politica se preceded de DROP IF EXISTS para que el archivo sea re-ejecutable.


-- ---- ENABLE ROW LEVEL SECURITY -------------------------------------------
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

ALTER TABLE public.meeting_attendance        ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.school_settings           ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_events             ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.terms_acceptance          ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.data_snapshots            ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.login_attempts            ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.system_errors             ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payment_concepts          ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.student_preregistrations  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.student_charges           ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_categories  ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_products     ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_orders       ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_order_items  ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_inventory    ENABLE ROW LEVEL SECURITY;

ALTER TABLE store_product_sizes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wall_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referral_codes  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referrals       ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donation_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donations          ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recovery_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kiosk_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.donation_settings ENABLE ROW LEVEL SECURITY;

-- OMITIDO (tabla eliminada en la migracion 10, el ALTER fallaria):
--   - ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY
--   - ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY
--   - ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY


-- ---- academic_periods ----------------------------------------------------
DROP POLICY IF EXISTS "academic_periods_staff" ON academic_periods;
CREATE POLICY "academic_periods_staff" ON public.academic_periods FOR ALL
  USING (get_my_role() IN ('directora','maestra','asistente','admin'));

DROP POLICY IF EXISTS "academic_periods_parent" ON academic_periods;
CREATE POLICY "academic_periods_parent" ON public.academic_periods FOR SELECT USING (auth.uid() IS NOT NULL);


-- ---- activities ----------------------------------------------------------
DROP POLICY IF EXISTS "activities_staff" ON activities;
CREATE POLICY "activities_staff" ON public.activities FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (
      SELECT 1 FROM public.period_config pc
      WHERE pc.id = activities.config_id AND pc.classroom_id IS NOT NULL
        AND public.is_classroom_accessible(pc.classroom_id)
    )
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR EXISTS (
      SELECT 1 FROM public.period_config pc
      WHERE pc.id = activities.config_id AND pc.classroom_id IS NOT NULL
        AND public.is_classroom_accessible(pc.classroom_id)
    )
  );


-- ---- attendance ----------------------------------------------------------
DROP POLICY IF EXISTS "attendance_staff" ON attendance;
CREATE POLICY "attendance_staff" ON public.attendance FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','admin')
      OR (
        get_my_role() = 'maestra'
        AND is_classroom_accessible(classroom_id)
      )
    );

DROP POLICY IF EXISTS "attendance_parent" ON attendance;
CREATE POLICY "attendance_parent" ON public.attendance FOR SELECT
  USING (public.is_family_member(attendance.student_id));


-- ---- attendance_requests -------------------------------------------------
DROP POLICY IF EXISTS "attendance_requests_staff" ON attendance_requests;
CREATE POLICY "attendance_requests_staff" ON public.attendance_requests FOR SELECT
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "attendance_requests_staff_update" ON attendance_requests;
CREATE POLICY "attendance_requests_staff_update" ON public.attendance_requests FOR UPDATE
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "attendance_requests_parent_select" ON attendance_requests;
CREATE POLICY "attendance_requests_parent_select" ON public.attendance_requests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = attendance_requests.student_id
      AND s.parent_id = auth.uid()
  ));

DROP POLICY IF EXISTS "attendance_requests_parent_insert" ON attendance_requests;
CREATE POLICY "attendance_requests_parent_insert" ON public.attendance_requests FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = attendance_requests.student_id
      AND s.parent_id = auth.uid()
  ));


-- ---- audit_logs ----------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_admin" ON audit_logs;
CREATE POLICY "audit_logs_admin" ON public.audit_logs FOR ALL
  USING (get_my_role() IN ('directora','admin'));

DROP POLICY IF EXISTS "audit_logs_staff" ON audit_logs;
CREATE POLICY "audit_logs_staff" ON public.audit_logs FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','admin')
      OR (
        get_my_role() = 'maestra'
        AND is_classroom_accessible(classroom_id)
      )
    );

DROP POLICY IF EXISTS "audit_logs_service_insert" ON audit_logs;
CREATE POLICY "audit_logs_service_insert" ON public.audit_logs FOR INSERT
    WITH CHECK (current_setting('role') = 'service_role');


-- ---- classroom_chat ------------------------------------------------------
DROP POLICY IF EXISTS "classroom_chat_access" ON classroom_chat;
CREATE POLICY "classroom_chat_access" ON public.classroom_chat FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "classroom_chat_classroom_members" ON classroom_chat;
CREATE POLICY "classroom_chat_classroom_members" ON public.classroom_chat FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','admin')
      OR is_teacher_of_classroom(classroom_id)
      OR is_parent_of_classroom(classroom_id)
    );


-- ---- classroom_event_schedule --------------------------------------------
DROP POLICY IF EXISTS "schedule_access_staff" ON classroom_event_schedule;
CREATE POLICY "schedule_access_staff" ON public.classroom_event_schedule FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "schedule_access_parent" ON classroom_event_schedule;
CREATE POLICY "schedule_access_parent" ON public.classroom_event_schedule FOR SELECT
  USING (public.is_classroom_accessible(classroom_id));


-- ---- classroom_gallery ---------------------------------------------------
DROP POLICY IF EXISTS "gallery_access" ON classroom_gallery;
CREATE POLICY "gallery_access" ON public.classroom_gallery FOR ALL
  USING (public.is_classroom_accessible(classroom_id))
  WITH CHECK (public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "gallery_classroom_members" ON classroom_gallery;
CREATE POLICY "gallery_classroom_members" ON public.classroom_gallery FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','admin')
      OR is_teacher_of_classroom(classroom_id)
      OR is_parent_of_classroom(classroom_id)
    );


-- ---- classrooms ----------------------------------------------------------
DROP POLICY IF EXISTS "classrooms_read_all" ON classrooms;
CREATE POLICY "classrooms_read_all" ON public.classrooms FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "classrooms_staff_write" ON classrooms;
CREATE POLICY "classrooms_staff_write" ON public.classrooms FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));


-- ---- comments ------------------------------------------------------------
DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON public.comments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON public.comments FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND (
      get_my_role() IN ('directora', 'asistente', 'maestra', 'admin')
      OR p.classroom_id IS NULL
      OR is_parent_of_classroom(p.classroom_id)
    )
  )
);


-- ---- conversation_participants -------------------------------------------
DROP POLICY IF EXISTS "conv_participants_all" ON conversation_participants;
CREATE POLICY "conv_participants_all" ON public.conversation_participants FOR ALL
  USING (auth.uid() IS NOT NULL);


-- ---- conversations -------------------------------------------------------
DROP POLICY IF EXISTS "conversations_participants" ON conversations;
CREATE POLICY "conversations_participants" ON public.conversations FOR ALL
  USING (auth.uid() IS NOT NULL);


-- ---- daily_logs ----------------------------------------------------------
DROP POLICY IF EXISTS "daily_logs_staff" ON daily_logs;
CREATE POLICY "daily_logs_staff" ON public.daily_logs FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','admin')
      OR (
        get_my_role() = 'maestra'
        AND is_classroom_accessible(classroom_id)
        AND date >= CURRENT_DATE
      )
    );

DROP POLICY IF EXISTS "daily_logs_parent" ON daily_logs;
CREATE POLICY "daily_logs_parent" ON public.daily_logs FOR SELECT
  USING (status = 'published' AND public.is_family_member(daily_logs.student_id));


-- ---- donation_campaigns --------------------------------------------------
DROP POLICY IF EXISTS "donation_campaigns_anon_select" ON donation_campaigns;
CREATE POLICY "donation_campaigns_anon_select" ON public.donation_campaigns
  FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "donation_campaigns_staff" ON donation_campaigns;
CREATE POLICY "donation_campaigns_staff" ON public.donation_campaigns FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- donation_settings ---------------------------------------------------
DROP POLICY IF EXISTS "donation_settings_public_select" ON donation_settings;
CREATE POLICY "donation_settings_public_select" ON public.donation_settings
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "donation_settings_staff" ON donation_settings;
CREATE POLICY "donation_settings_staff" ON public.donation_settings
  FOR ALL TO authenticated
  USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- donations -----------------------------------------------------------
DROP POLICY IF EXISTS "donations_staff" ON donations;
CREATE POLICY "donations_staff" ON public.donations FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- door_punches --------------------------------------------------------
DROP POLICY IF EXISTS "punches_staff_all" ON door_punches;
CREATE POLICY "punches_staff_all" ON public.door_punches FOR ALL
    USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "punches_parent_read" ON door_punches;
CREATE POLICY "punches_parent_read" ON public.door_punches FOR SELECT
  USING (public.is_family_member(door_punches.student_id));


-- ---- enrollments ---------------------------------------------------------
DROP POLICY IF EXISTS "enrollments_staff" ON enrollments;
CREATE POLICY "enrollments_staff" ON public.enrollments FOR ALL
  USING (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "enrollments_parent" ON enrollments;
CREATE POLICY "enrollments_parent" ON public.enrollments FOR SELECT USING (parent_id = auth.uid());


-- ---- grades --------------------------------------------------------------
DROP POLICY IF EXISTS "grades_staff" ON grades;
CREATE POLICY "grades_staff" ON public.grades FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_grade_accessible(classroom_id, activity_id))
  WITH CHECK (
    get_my_role() IN ('directora','asistente','maestra','admin')
    AND public.is_grade_accessible(classroom_id, activity_id)
    AND (period_id IS NULL OR public.is_period_open(period_id) OR get_my_role() IN ('directora','admin'))
  );

DROP POLICY IF EXISTS "grades_parent" ON grades;
CREATE POLICY "grades_parent" ON public.grades FOR SELECT
  USING (public.is_family_member(grades.student_id));


-- ---- incidents -----------------------------------------------------------
DROP POLICY IF EXISTS "incidents_staff" ON incidents;
CREATE POLICY "incidents_staff" ON public.incidents FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "incidents_parent" ON incidents;
CREATE POLICY "incidents_parent" ON public.incidents FOR SELECT
  USING (public.is_family_member(incidents.student_id));


-- ---- inquiries -----------------------------------------------------------
DROP POLICY IF EXISTS "inquiries_parent" ON inquiries;
CREATE POLICY "inquiries_parent" ON public.inquiries FOR ALL USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "inquiries_staff" ON inquiries;
CREATE POLICY "inquiries_staff" ON public.inquiries FOR ALL
  USING (get_my_role() IN ('directora','asistente','admin'));


-- ---- likes ---------------------------------------------------------------
DROP POLICY IF EXISTS "likes_select" ON likes;
CREATE POLICY "likes_select" ON public.likes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.posts p WHERE p.id = likes.post_id
    AND (
      auth.uid() IS NOT NULL AND (
        get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
        OR p.classroom_id IS NULL
        OR is_teacher_of_classroom(p.classroom_id)
        OR is_parent_of_classroom(p.classroom_id)
      )
    )
  )
);


-- ---- login_attempts ------------------------------------------------------
DROP POLICY IF EXISTS "login_attempts_insert" ON login_attempts;
CREATE POLICY "login_attempts_insert" ON public.login_attempts FOR INSERT WITH CHECK (true);


-- ---- meeting_attendance --------------------------------------------------
DROP POLICY IF EXISTS "meeting_att_all" ON meeting_attendance;
CREATE POLICY "meeting_att_all" ON public.meeting_attendance FOR ALL
  USING (auth.uid() IS NOT NULL);


-- ---- meetings ------------------------------------------------------------
DROP POLICY IF EXISTS "meetings_staff" ON meetings;
CREATE POLICY "meetings_staff" ON public.meetings FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "meetings_parent" ON meetings;
CREATE POLICY "meetings_parent" ON public.meetings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students
                 WHERE classroom_id = meetings.target_id::bigint AND public.is_family_member(id)));


-- ---- messages ------------------------------------------------------------
DROP POLICY IF EXISTS "messages_all" ON messages;
CREATE POLICY "messages_all" ON public.messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "messages_staff_view_all" ON messages;
CREATE POLICY "messages_staff_view_all" ON public.messages FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','directora','asistente'));


-- ---- notifications -------------------------------------------------------
DROP POLICY IF EXISTS "notifications_own" ON notifications;
CREATE POLICY "notifications_own" ON public.notifications FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_staff_insert" ON notifications;
CREATE POLICY "notifications_staff_insert" ON public.notifications FOR INSERT
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') OR user_id = auth.uid());


-- ---- payment_concepts ----------------------------------------------------
DROP POLICY IF EXISTS "payment_concepts_read" ON payment_concepts;
CREATE POLICY "payment_concepts_read" ON public.payment_concepts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "payment_concepts_staff" ON payment_concepts;
CREATE POLICY "payment_concepts_staff" ON public.payment_concepts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));


-- ---- payments ------------------------------------------------------------
DROP POLICY IF EXISTS "payments_staff_can_see_all" ON payments;
CREATE POLICY "payments_staff_can_see_all" ON public.payments
  FOR SELECT
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

DROP POLICY IF EXISTS "payments_staff_can_insert" ON payments;
CREATE POLICY "payments_staff_can_insert" ON public.payments
  FOR INSERT
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

DROP POLICY IF EXISTS "payments_staff_can_update" ON payments;
CREATE POLICY "payments_staff_can_update" ON public.payments
  FOR UPDATE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  )
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

DROP POLICY IF EXISTS "payments_staff_can_delete" ON payments;
CREATE POLICY "payments_staff_can_delete" ON public.payments
  FOR DELETE
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1), '')
    IN ('directora', 'asistente', 'admin')
  );

DROP POLICY IF EXISTS "payments_parent_see_own" ON payments;
CREATE POLICY "payments_parent_see_own" ON public.payments FOR SELECT
  USING (public.is_family_member(payments.student_id));

DROP POLICY IF EXISTS "payments_parent_can_submit" ON payments;
CREATE POLICY "payments_parent_can_submit" ON public.payments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = payments.student_id
      AND students.parent_id = auth.uid()
      AND students.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "payments_parent_can_update_own" ON payments;
CREATE POLICY "payments_parent_can_update_own" ON public.payments FOR UPDATE
  USING (public.is_family_member(payments.student_id))
  WITH CHECK (public.is_family_member(payments.student_id) AND status IN ('pending','overdue','review'));


-- ---- period_config -------------------------------------------------------
DROP POLICY IF EXISTS "period_config_staff" ON period_config;
CREATE POLICY "period_config_staff" ON public.period_config FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );


-- ---- periods -------------------------------------------------------------
DROP POLICY IF EXISTS "periods_staff" ON periods;
CREATE POLICY "periods_staff" ON public.periods FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "periods_parent" ON periods;
CREATE POLICY "periods_parent" ON public.periods FOR SELECT USING (auth.uid() IS NOT NULL);


-- ---- posts ---------------------------------------------------------------
DROP POLICY IF EXISTS "posts_select" ON posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT USING (
  auth.uid() IS NOT NULL
  AND (
    get_my_role() IN ('directora', 'asistente', 'admin', 'maestra')
    OR classroom_id IS NULL
    OR is_teacher_of_classroom(classroom_id)
    OR is_parent_of_classroom(classroom_id)
  )
);

DROP POLICY IF EXISTS "posts_insert" ON posts;
CREATE POLICY "posts_insert" ON public.posts
    FOR INSERT WITH CHECK (auth.uid() = teacher_id AND get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "posts_update" ON posts;
CREATE POLICY "posts_update" ON public.posts FOR UPDATE
  USING (auth.uid() = teacher_id OR get_my_role() IN ('directora','admin'));

DROP POLICY IF EXISTS "posts_delete" ON posts;
CREATE POLICY "posts_delete" ON public.posts FOR DELETE
  USING (auth.uid() = teacher_id OR get_my_role() IN ('directora','admin'));


-- ---- profiles ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (
  deleted_at IS NULL AND (

    auth.uid() = id

    OR get_my_role() IN ('directora', 'asistente', 'admin')

    OR (
      get_my_role() = 'padre'
      AND role IN ('directora', 'asistente')
    )

    OR (
      get_my_role() = 'padre'
      AND id IN (
        SELECT c.teacher_id
        FROM public.classrooms c
        JOIN public.students s ON s.classroom_id = c.id
        WHERE s.parent_id = auth.uid()
          AND c.teacher_id IS NOT NULL
      )
    )

    OR (
      get_my_role() = 'maestra'
      AND role IN ('directora', 'asistente')
    )

    OR (
      get_my_role() = 'maestra'
      AND id IN (
        SELECT s.parent_id
        FROM public.students s
        WHERE s.parent_id IS NOT NULL
          AND s.deleted_at IS NULL
          AND s.classroom_id IN (
            SELECT c.id FROM public.classrooms c WHERE c.teacher_id = auth.uid()
          )
      )
    )
  )
);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (
  get_my_role() IN ('directora','admin')
);

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (
  deleted_at IS NULL AND (auth.uid() = id OR get_my_role() IN ('directora','admin'))
);

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON public.profiles FOR DELETE USING (
  get_my_role() IN ('directora','admin')
);


-- ---- recovery_requests ---------------------------------------------------
DROP POLICY IF EXISTS "recovery_requests_service_only" ON recovery_requests;
CREATE POLICY "recovery_requests_service_only"
  ON public.recovery_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ---- referral_codes ------------------------------------------------------
DROP POLICY IF EXISTS "referral_codes_staff" ON referral_codes;
CREATE POLICY "referral_codes_staff" ON public.referral_codes FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "referral_codes_parent" ON referral_codes;
CREATE POLICY "referral_codes_parent" ON public.referral_codes FOR SELECT
  TO authenticated USING (parent_id = auth.uid());


-- ---- referral_rewards ----------------------------------------------------
DROP POLICY IF EXISTS "referral_rewards_staff" ON referral_rewards;
CREATE POLICY "referral_rewards_staff" ON public.referral_rewards FOR ALL
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'))
  WITH CHECK (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "referral_rewards_parent" ON referral_rewards;
CREATE POLICY "referral_rewards_parent" ON public.referral_rewards FOR SELECT
  TO authenticated USING (parent_id = auth.uid());

DROP POLICY IF EXISTS "referral_rewards_parent_update" ON referral_rewards;
CREATE POLICY "referral_rewards_parent_update" ON public.referral_rewards FOR UPDATE
  TO authenticated USING (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());


-- ---- referrals -----------------------------------------------------------
DROP POLICY IF EXISTS "referrals_staff" ON referrals;
CREATE POLICY "referrals_staff" ON public.referrals FOR SELECT
  TO authenticated USING (get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "referrals_parent" ON referrals;
CREATE POLICY "referrals_parent" ON public.referrals FOR ALL
  TO authenticated USING (referrer_parent_id = auth.uid())
  WITH CHECK (referrer_parent_id = auth.uid());


-- ---- report_cards --------------------------------------------------------
DROP POLICY IF EXISTS "report_cards_staff" ON report_cards;
CREATE POLICY "report_cards_staff" ON public.report_cards FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "report_cards_parent" ON report_cards;
CREATE POLICY "report_cards_parent" ON public.report_cards FOR SELECT
  USING (public.is_family_member(report_cards.student_id));


-- ---- reports -------------------------------------------------------------
DROP POLICY IF EXISTS "reports_select" ON reports;
CREATE POLICY "reports_select" ON public.reports FOR SELECT USING (
  deleted_at IS NULL AND (get_my_role() IN ('directora','admin') OR target_id = auth.uid() OR reporter_id = auth.uid())
);

DROP POLICY IF EXISTS "reports_insert" ON reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (get_my_role() IN ('directora','admin'));

DROP POLICY IF EXISTS "reports_update" ON reports;
CREATE POLICY "reports_update" ON public.reports FOR UPDATE USING (deleted_at IS NULL AND get_my_role() IN ('directora','admin'));


-- ---- school_settings -----------------------------------------------------
DROP POLICY IF EXISTS "school_settings_select" ON school_settings;
CREATE POLICY "school_settings_select" ON public.school_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "school_settings_insert" ON school_settings;
CREATE POLICY "school_settings_insert" ON public.school_settings FOR INSERT
  WITH CHECK (get_my_role() IN ('admin','directora'));

DROP POLICY IF EXISTS "school_settings_update" ON school_settings;
CREATE POLICY "school_settings_update" ON public.school_settings FOR UPDATE
  USING (get_my_role() IN ('admin','directora'))
  WITH CHECK (get_my_role() IN ('admin','directora'));


-- ---- school_years --------------------------------------------------------
DROP POLICY IF EXISTS "school_years_staff" ON school_years;
CREATE POLICY "school_years_staff" ON public.school_years FOR ALL
  USING (get_my_role() IN ('directora','admin'))
  WITH CHECK (get_my_role() IN ('directora','admin'));

DROP POLICY IF EXISTS "school_years_read" ON school_years;
CREATE POLICY "school_years_read" ON public.school_years FOR SELECT USING (auth.uid() IS NOT NULL);


-- ---- staff_permits -------------------------------------------------------
DROP POLICY IF EXISTS "permits_staff" ON staff_permits;
CREATE POLICY "permits_staff" ON public.staff_permits FOR ALL
  USING (get_my_role() IN ('directora','admin') OR staff_id = auth.uid());


-- ---- storage.objects -----------------------------------------------------
DROP POLICY IF EXISTS "preinscripcion_docs_public_read" ON storage.objects;
CREATE POLICY "preinscripcion_docs_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'preinscripcion-docs');

DROP POLICY IF EXISTS "preinscripcion_docs_public_insert" ON storage.objects;
CREATE POLICY "preinscripcion_docs_public_insert" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'preinscripcion-docs');

DROP POLICY IF EXISTS "preinscripcion_docs_staff_delete" ON storage.objects;
CREATE POLICY "preinscripcion_docs_staff_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'preinscripcion-docs'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='avatars' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "classroom_media_public_read" ON storage.objects;
CREATE POLICY "classroom_media_public_read" ON storage.objects FOR SELECT USING (bucket_id='classroom_media');

DROP POLICY IF EXISTS "classroom_media_auth_insert" ON storage.objects;
CREATE POLICY "classroom_media_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='classroom_media' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "classroom_media_auth_update" ON storage.objects;
CREATE POLICY "classroom_media_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='classroom_media' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_public_read" ON storage.objects;
CREATE POLICY "karpus_uploads_public_read" ON storage.objects FOR SELECT USING (bucket_id='karpus-uploads');

DROP POLICY IF EXISTS "karpus_uploads_auth_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='karpus-uploads' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_auth_update" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');

DROP POLICY IF EXISTS "karpus_uploads_auth_delete" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');


-- ---- store_categories ----------------------------------------------------
DROP POLICY IF EXISTS "store_categories_read" ON store_categories;
CREATE POLICY "store_categories_read" ON store_categories
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "store_categories_write_staff" ON store_categories;
CREATE POLICY "store_categories_write_staff" ON store_categories
    FOR ALL TO authenticated
    USING   (get_my_role() IN ('directora','asistente','admin'))
    WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- store_inventory -----------------------------------------------------
DROP POLICY IF EXISTS "store_inventory_staff" ON store_inventory;
CREATE POLICY "store_inventory_staff" ON store_inventory
    FOR ALL TO authenticated
    USING   (get_my_role() IN ('directora','asistente','admin'))
    WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- store_order_items ---------------------------------------------------
DROP POLICY IF EXISTS "store_order_items_read" ON store_order_items;
CREATE POLICY "store_order_items_read" ON store_order_items
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM store_orders o
        WHERE o.id = order_id
          AND (o.parent_id = auth.uid() OR get_my_role() IN ('directora','asistente','admin'))
      )
    );

DROP POLICY IF EXISTS "store_order_items_insert" ON store_order_items;
CREATE POLICY "store_order_items_insert" ON store_order_items
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM store_orders o
        WHERE o.id = order_id AND o.parent_id = auth.uid()
      )
    );


-- ---- store_orders --------------------------------------------------------
DROP POLICY IF EXISTS "store_orders_parent_read" ON store_orders;
CREATE POLICY "store_orders_parent_read" ON store_orders
    FOR SELECT TO authenticated
    USING (parent_id = auth.uid() OR get_my_role() IN ('directora','asistente','admin'));

DROP POLICY IF EXISTS "store_orders_parent_insert" ON store_orders;
CREATE POLICY "store_orders_parent_insert" ON store_orders
    FOR INSERT TO authenticated
    WITH CHECK (parent_id = auth.uid());

DROP POLICY IF EXISTS "store_orders_staff_update" ON store_orders;
CREATE POLICY "store_orders_staff_update" ON store_orders
    FOR UPDATE TO authenticated
    USING (get_my_role() IN ('directora','asistente','admin'));


-- ---- store_product_sizes -------------------------------------------------
DROP POLICY IF EXISTS "store_sizes_read" ON store_product_sizes;
CREATE POLICY "store_sizes_read" ON store_product_sizes
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "store_sizes_write_staff" ON store_product_sizes;
CREATE POLICY "store_sizes_write_staff" ON store_product_sizes
    FOR ALL TO authenticated
    USING   (get_my_role() IN ('directora','asistente','admin'))
    WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- store_products ------------------------------------------------------
DROP POLICY IF EXISTS "store_products_read" ON store_products;
CREATE POLICY "store_products_read" ON store_products
    FOR SELECT TO authenticated USING (is_active = TRUE);

DROP POLICY IF EXISTS "store_products_write_staff" ON store_products;
CREATE POLICY "store_products_write_staff" ON store_products
    FOR ALL TO authenticated
    USING   (get_my_role() IN ('directora','asistente','admin'))
    WITH CHECK (get_my_role() IN ('directora','asistente','admin'));


-- ---- student_charges -----------------------------------------------------
DROP POLICY IF EXISTS "charges_staff" ON student_charges;
CREATE POLICY "charges_staff" ON public.student_charges FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

DROP POLICY IF EXISTS "charges_parent" ON student_charges;
CREATE POLICY "charges_parent" ON public.student_charges FOR SELECT
  USING (public.is_family_member(student_charges.student_id));


-- ---- student_history -----------------------------------------------------
DROP POLICY IF EXISTS "student_history_staff" ON student_history;
CREATE POLICY "student_history_staff" ON public.student_history FOR ALL
  USING (get_my_role() IN ('directora','admin'));

DROP POLICY IF EXISTS "student_history_teacher" ON student_history;
CREATE POLICY "student_history_teacher" ON public.student_history FOR SELECT
  USING (get_my_role() IN ('maestra','asistente'));

DROP POLICY IF EXISTS "student_history_parent" ON student_history;
CREATE POLICY "student_history_parent" ON public.student_history FOR SELECT
  USING (public.is_family_member(student_history.student_id));


-- ---- student_preregistrations --------------------------------------------
DROP POLICY IF EXISTS "prereg_insert_public" ON student_preregistrations;
CREATE POLICY "prereg_insert_public" ON public.student_preregistrations FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "prereg_insert_auth" ON student_preregistrations;
CREATE POLICY "prereg_insert_auth" ON public.student_preregistrations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "prereg_staff" ON student_preregistrations;
CREATE POLICY "prereg_staff" ON public.student_preregistrations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));

DROP POLICY IF EXISTS "prereg_staff_update" ON student_preregistrations;
CREATE POLICY "prereg_staff_update" ON public.student_preregistrations FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('directora','asistente','admin')));


-- ---- students ------------------------------------------------------------
DROP POLICY IF EXISTS "students_staff" ON students;
CREATE POLICY "students_staff" ON public.students FOR ALL
  USING (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  )
  WITH CHECK (
    get_my_role() IN ('directora','asistente','admin')
    OR (get_my_role() = 'maestra' AND classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );

DROP POLICY IF EXISTS "students_parent" ON students;
CREATE POLICY "students_parent" ON public.students FOR SELECT
  USING (public.is_family_member(id) AND deleted_at IS NULL);


-- ---- subject_averages ----------------------------------------------------
DROP POLICY IF EXISTS "subject_averages_staff" ON subject_averages;
CREATE POLICY "subject_averages_staff" ON public.subject_averages FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin'));

DROP POLICY IF EXISTS "subject_averages_parent" ON subject_averages;
CREATE POLICY "subject_averages_parent" ON public.subject_averages FOR SELECT
  USING (public.is_family_member(subject_averages.student_id));


-- ---- subjects ------------------------------------------------------------
DROP POLICY IF EXISTS "subjects_access" ON subjects;
CREATE POLICY "subjects_access" ON public.subjects FOR SELECT
  USING (
    (classroom_id IS NULL AND get_my_role() IN ('directora','asistente','maestra','admin'))
    OR (classroom_id IS NOT NULL AND public.is_classroom_accessible(classroom_id))
  );


-- ---- task_evidences ------------------------------------------------------
DROP POLICY IF EXISTS "evidences_staff" ON task_evidences;
CREATE POLICY "evidences_staff" ON public.task_evidences FOR ALL
    USING (
      get_my_role() IN ('directora','asistente','maestra','admin')
      AND is_classroom_accessible(
        (SELECT t.classroom_id FROM public.tasks t WHERE t.id = task_evidences.task_id)
      )
    );

DROP POLICY IF EXISTS "evidences_parent_insert" ON task_evidences;
CREATE POLICY "evidences_parent_insert" ON public.task_evidences FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_family_member(task_evidences.student_id)
  );

DROP POLICY IF EXISTS "evidences_parent_select" ON task_evidences;
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


-- ---- tasks ---------------------------------------------------------------
DROP POLICY IF EXISTS "tasks_staff" ON tasks;
CREATE POLICY "tasks_staff" ON public.tasks FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "tasks_parent" ON tasks;
CREATE POLICY "tasks_parent" ON public.tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.students s
                 WHERE s.classroom_id = tasks.classroom_id
                   AND public.is_family_member(s.id)));


-- ---- timeline_event_log --------------------------------------------------
DROP POLICY IF EXISTS "timeline_log_access_staff" ON timeline_event_log;
CREATE POLICY "timeline_log_access_staff" ON public.timeline_event_log FOR ALL
  USING (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id))
  WITH CHECK (get_my_role() IN ('directora','asistente','maestra','admin') AND public.is_classroom_accessible(classroom_id));

DROP POLICY IF EXISTS "timeline_log_access_parent" ON timeline_event_log;
CREATE POLICY "timeline_log_access_parent" ON public.timeline_event_log FOR SELECT
  USING (public.is_classroom_accessible(classroom_id));


-- ---- wall_notifications --------------------------------------------------
DROP POLICY IF EXISTS "wall_notifications_own" ON wall_notifications;
CREATE POLICY "wall_notifications_own" ON public.wall_notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "wall_notifications_insert_auth" ON wall_notifications;
CREATE POLICY "wall_notifications_insert_auth" ON public.wall_notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- OMITIDAS (tabla eliminada en la migracion 10): payment_audit_log
