-- ============================================================
-- KARPUS KIDS — Schema Unificado v4.0
-- Consolidación de TODAS las migraciones en un solo archivo.
-- Ejecutar en Supabase SQL Editor de arriba a abajo.
-- Última actualización: Agosto 2026
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 0: LIMPIEZA DE FUNCIONES ANTERIORES
-- ══════════════════════════════════════════════════════════════
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, n.nspname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'financial_summary_month','generate_report_card','close_period',
        'mark_conversation_read','user_is_participant','generate_monthly_charges',
        'get_current_period','get_tasks_for_period','get_posts_for_period',
        'activate_period','get_student_history','is_period_open','get_active_period',
        'get_student_total_debt','is_teacher_of_classroom','is_parent_of_student',
        'is_parent_of_classroom','is_teacher_of_student','get_my_classroom_ids',
        'run_payment_cycle','get_unread_counts','get_dashboard_kpis',
        'get_monthly_financial_report_by_classroom','attendance_last_7_days',
        'find_or_create_private_conversation','get_direct_messages',
        'send_notification','get_my_role','can_access_app','handle_new_user',
        'handle_new_post_teacher_info','update_post_comments_count',
        'update_post_likes_count','handle_student_chat_creation',
        'notify_parent_on_new_charge','create_students_snapshot',
        'create_payments_snapshot','cleanup_old_login_attempts',
        'assign_student_to_classroom','assign_students_bulk','set_updated_at',
        'upload_payment_proof','calculate_mora','calc_mora','calculate_mora_v2',
        'preview_payment_cycle','check_payment_cycle_health',
        'process_door_punch','process_student_punch','approve_payment',
        'delete_payment','waive_payment_mora','reset_payment_to_pending',
        'is_email_under_attack','mark_messages_read','search_students',
        'update_staff_permits_timestamp','fn_audit_payment','fn_audit_role_change',
        'fn_validate_role_change','fn_protect_paid_records',
        'fn_on_payment_evidence_uploaded','payment_audit_trigger_fn',
        'mark_overdue_payments','generate_annual_payments','pay_full_year',
        'get_active_school_year','get_school_year_status','close_school_year',
        'promote_students','can_enroll_student','can_reenroll_student',
        'get_enrollment_status','advance_school_year_state','get_period_stats',
        'get_periods_for_year','create_school_year','update_school_year',
        'create_academic_period','delete_academic_periods_by_year',
        'get_first_academic_period','activate_academic_period',
        'get_legacy_periods_for_sync','get_period_config',
        'get_activities_with_grades','get_student_grades_v2',
        'get_student_subject_averages','get_classroom_schedule',
        'log_timeline_event','audit_report_change','fn_validate_avatar_url',
        'fn_audit_payment_changes','check_payment_cycle_health'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      fn.nspname, fn.proname,
      pg_get_function_identity_arguments(fn.oid));
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 1: EXTENSIONES
-- ══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 2: TIPOS CUSTOM
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE permit_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE permit_type AS ENUM ('permission','absence','medical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 3: FUNCIÓN UTILITARIA (necesaria antes de tablas)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 4: TABLAS CORE
-- ══════════════════════════════════════════════════════════════

-- 4.1 PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               text UNIQUE,
  name                text,
  matricula           text UNIQUE,
  role                text CHECK (role IN ('directora','maestra','padre','asistente','admin')),
  avatar_url          text,
  phone               text,
  bio                 text,
  notes               text,
  access_code         text UNIQUE,
  qr_code             text,
  onesignal_player_id text,
  deleted_at          timestamp with time zone,
  is_active           boolean DEFAULT true,
  accepted_terms      boolean DEFAULT false,
  accepted_terms_at   timestamp with time zone,
  last_sign_in_at     timestamp with time zone,
  search_vector       tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))
  ) STORED,
  created_at          timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('directora','maestra','padre','asistente','admin'));

-- 4.2 CLASSROOMS
CREATE TABLE IF NOT EXISTS public.classrooms (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  level      text,
  capacity   integer DEFAULT 20,
  teacher_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_live    boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.3 SCHOOL YEARS (Motor central del ciclo escolar)
CREATE TABLE IF NOT EXISTS public.school_years (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name                text NOT NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  enrollment_start    date,
  enrollment_end      date,
  reenrollment_start  date,
  reenrollment_end    date,
  status              text DEFAULT 'draft'
                      CHECK (status IN ('draft','enrollment','reenrollment','active','closed','archived')),
  created_by          uuid REFERENCES public.profiles(id),
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  updated_at          timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT valid_dates CHECK (end_date > start_date),
  CONSTRAINT valid_enrollment CHECK (
    enrollment_start IS NULL OR enrollment_end IS NULL OR enrollment_end >= enrollment_start),
  CONSTRAINT valid_reenrollment CHECK (
    reenrollment_start IS NULL OR reenrollment_end IS NULL OR reenrollment_end >= reenrollment_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_years_one_active
  ON public.school_years (status)
  WHERE status IN ('active','enrollment','reenrollment');

-- 4.4 ACADEMIC PERIODS (Vinculados al año escolar)
CREATE TABLE IF NOT EXISTS public.academic_periods (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  school_year_id  bigint NOT NULL REFERENCES public.school_years(id) ON DELETE CASCADE,
  name            text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  order_index     integer NOT NULL DEFAULT 1,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','open','closed')),
  is_active       boolean DEFAULT false,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT valid_period_dates CHECK (end_date > start_date),
  CONSTRAINT unique_period_order UNIQUE (school_year_id, order_index)
);

-- 4.5 LEGACY PERIODS (compatibilidad con módulos existentes)
CREATE TABLE IF NOT EXISTS public.periods (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text DEFAULT 'open' CHECK (status IN ('open','closed')),
  is_active    boolean DEFAULT false,
  classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.6 STUDENTS
CREATE TABLE IF NOT EXISTS public.students (
  id                      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name                    text NOT NULL,
  classroom_id            bigint REFERENCES public.classrooms(id) ON DELETE SET NULL,
  parent_id               uuid REFERENCES public.profiles(id),
  school_year_id          bigint REFERENCES public.school_years(id),
  academic_period_id      bigint REFERENCES public.academic_periods(id),
  is_active               boolean DEFAULT true,
  avatar_url              text,
  matricula               text,
  age                     integer,
  age_type                text DEFAULT 'años' CHECK (age_type IN ('años','meses')),
  schedule                text,
  start_date              date,
  blood_type              text,
  allergies               text,
  authorized_pickup       text,
  authorized_pickup_phone text,
  p1_name                 text, p1_phone text, p1_email text,
  p1_job                  text, p1_address text, p1_emergency_contact text,
  p2_name                 text, p2_phone text, p2_email text,
  p2_job                  text, p2_address text, p2_emergency_contact text,
  monthly_fee             numeric DEFAULT 0,
  prolongado_fee          numeric DEFAULT 0,
  due_day                 integer DEFAULT 5,
  qr_code                 text,
  enrollment_type         text DEFAULT 'new' CHECK (enrollment_type IN ('new','reenrollment')),
  enrolled_at             timestamp with time zone,
  deleted_at              timestamp with time zone,
  search_vector           tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(matricula,'') || ' ' ||
      coalesce(p1_name,'') || ' ' || coalesce(p1_phone,''))
  ) STORED,
  created_at              timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_matricula
  ON public.students(matricula) WHERE matricula IS NOT NULL;

-- 4.7 ATTENDANCE
CREATE TABLE IF NOT EXISTS public.attendance (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id          bigint NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id        bigint NOT NULL REFERENCES public.classrooms(id),
  date                date DEFAULT current_date,
  status              text CHECK (status IN ('present','absent','late','retirado')),
  check_in            timestamp with time zone,
  check_out           timestamp with time zone,
  school_year_id      bigint REFERENCES public.school_years(id),
  academic_period_id  bigint REFERENCES public.academic_periods(id),
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(student_id, date)
);

-- 4.8 ATTENDANCE REQUESTS
CREATE TABLE IF NOT EXISTS public.attendance_requests (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id bigint REFERENCES public.students(id) ON DELETE CASCADE,
  date       date NOT NULL,
  reason     text NOT NULL,
  note       text,
  status     text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.9 TASKS
CREATE TABLE IF NOT EXISTS public.tasks (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id    bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  period_id       bigint REFERENCES public.periods(id) ON DELETE SET NULL,
  school_year_id  bigint REFERENCES public.school_years(id),
  title           text NOT NULL,
  description     text,
  due_date        timestamp with time zone,
  file_url        text,
  grading_system  text DEFAULT 'letter_stars',
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.10 TASK EVIDENCES
CREATE TABLE IF NOT EXISTS public.task_evidences (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  task_id      bigint REFERENCES public.tasks(id) ON DELETE CASCADE,
  student_id   bigint REFERENCES public.students(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES public.profiles(id),
  file_url     text,
  comment      text,
  status       text DEFAULT 'submitted',
  grade_letter text CHECK (grade_letter IN ('A','B','C','D')),
  stars        integer CHECK (stars >= 1 AND stars <= 5),
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(task_id, student_id)
);

-- 4.11 POSTS
CREATE TABLE IF NOT EXISTS public.posts (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id    bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id      uuid REFERENCES public.profiles(id),
  period_id       bigint REFERENCES public.periods(id) ON DELETE SET NULL,
  school_year_id  bigint REFERENCES public.school_years(id),
  content         text,
  media_url       text,
  media_type      text,
  image_url       text,
  images          text[] DEFAULT '{}',
  title           text,
  teacher_name    text,
  teacher_avatar  text,
  likes_count     integer DEFAULT 0,
  comments_count  integer DEFAULT 0,
  updated_at      timestamp with time zone DEFAULT now(),
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.12 COMMENTS & LIKES
CREATE TABLE IF NOT EXISTS public.comments (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  post_id    bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name  text,
  content    text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.likes (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction_type text DEFAULT 'like',
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(post_id, user_id)
);

-- 4.13 CHAT / MESSAGES
CREATE TABLE IF NOT EXISTS public.conversations (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  type         text DEFAULT 'direct_message'
               CHECK (type IN ('direct_message','private','classroom','group')),
  classroom_id bigint REFERENCES public.classrooms(id) ON DELETE SET NULL,
  updated_at   timestamp with time zone DEFAULT now(),
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id bigint REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id     uuid REFERENCES public.profiles(id),
  sender_name     text,
  sender_avatar   text,
  content         text NOT NULL,
  is_read         boolean DEFAULT false,
  read_at         timestamp with time zone,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.14 NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      text NOT NULL,
  message    text NOT NULL,
  type       text DEFAULT 'info',
  link       text,
  is_read    boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.15 PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
  id                   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id           bigint REFERENCES public.students(id) ON DELETE CASCADE,
  amount               numeric(10,2) NOT NULL,
  concept              text DEFAULT 'Mensualidad',
  status               text DEFAULT 'pending',
  month_paid           text,
  due_date             date,
  paid_date            timestamp with time zone,
  method               text,
  bank                 text,
  reference            text,
  transfer_date        date,
  proof_url            text,
  evidence_url         text,
  notes                text,
  validated_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_reminder_sent   timestamp with time zone,
  deleted_at           timestamp with time zone,
  updated_at           timestamp with time zone DEFAULT now(),
  created_at           timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_student_month
  ON public.payments(student_id, month_paid)
  WHERE month_paid IS NOT NULL AND deleted_at IS NULL;

-- 4.16 PAYMENT AUDIT LOG
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  payment_id  bigint NOT NULL,
  action      text NOT NULL,
  old_status  text,
  new_status  text,
  changed_by  uuid REFERENCES public.profiles(id),
  actor_name  text,
  actor_role  text,
  details     jsonb DEFAULT '{}',
  changed_at  timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.17 PAYMENT PLANS & INSTALLMENTS
CREATE TABLE IF NOT EXISTS public.payment_plans (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id      bigint REFERENCES public.students(id) ON DELETE CASCADE,
  year            int NOT NULL,
  total_amount    numeric(10,2),
  monthly_amount  numeric(10,2),
  months_total    int DEFAULT 12,
  discount        numeric DEFAULT 0,
  paid_percentage numeric DEFAULT 0,
  status          text DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at      timestamp with time zone DEFAULT now(),
  UNIQUE(student_id, year)
);

CREATE TABLE IF NOT EXISTS public.payment_installments (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  plan_id      bigint REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  student_id   bigint REFERENCES public.students(id) ON DELETE CASCADE,
  month_paid   text,
  amount       numeric(10,2),
  due_date     date,
  status       text DEFAULT 'pending',
  paid_date    timestamp with time zone,
  method       text,
  bank         text,
  evidence_url text,
  created_at   timestamp with time zone DEFAULT now(),
  UNIQUE(student_id, month_paid)
);

-- 4.18 GRADES
CREATE TABLE IF NOT EXISTS public.grades (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id    bigint REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id  bigint REFERENCES public.classrooms(id),
  period_id     bigint REFERENCES public.periods(id),
  school_year_id bigint REFERENCES public.school_years(id),
  activity_id   bigint,  -- FK a activities se agrega después
  subject       text,
  score         numeric(4,2),
  score_v2      numeric(5,2) CHECK (score_v2 >= 0 AND score_v2 <= 100),
  period        text,
  teacher_id    uuid REFERENCES public.profiles(id),
  notes         text,
  created_at    timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.19 SUBJECTS
CREATE TABLE IF NOT EXISTS public.subjects (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  education_level text NOT NULL CHECK (education_level IN ('estancia','preescolar','primaria')),
  description     text,
  is_active       boolean DEFAULT true,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.20 PERIOD CONFIG & ACTIVITIES
CREATE TABLE IF NOT EXISTS public.period_config (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  period_id       bigint REFERENCES public.periods(id) ON DELETE CASCADE NOT NULL,
  subject_id      bigint REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  activity_count  int NOT NULL CHECK (activity_count >= 5 AND activity_count <= 8),
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(period_id, subject_id)
);

CREATE TABLE IF NOT EXISTS public.activities (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  config_id       bigint REFERENCES public.period_config(id) ON DELETE CASCADE NOT NULL,
  title           text NOT NULL,
  description     text,
  max_score       numeric(5,2) DEFAULT 100,
  activity_number int NOT NULL,
  is_mandatory    boolean DEFAULT true,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(config_id, activity_number)
);
-- Añadir FK activity_id a grades ahora que activities existe
ALTER TABLE public.grades ADD CONSTRAINT fk_grades_activity
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE
  NOT VALID;

-- 4.21 SUBJECT AVERAGES
CREATE TABLE IF NOT EXISTS public.subject_averages (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id   bigint REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  period_id    bigint REFERENCES public.periods(id) ON DELETE CASCADE NOT NULL,
  subject_id   bigint REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  average      numeric(5,2) NOT NULL,
  graded_count int NOT NULL DEFAULT 0,
  method       text DEFAULT 'best_5' CHECK (method IN ('best_5','all')),
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(student_id, period_id, subject_id)
);

-- 4.22 REPORT CARDS
CREATE TABLE IF NOT EXISTS public.report_cards (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id     bigint REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id   bigint REFERENCES public.classrooms(id),
  period_id      bigint REFERENCES public.periods(id),
  school_year_id bigint REFERENCES public.school_years(id),
  task_avg       numeric(4,2),
  formal_avg     numeric(4,2),
  final_score    numeric(4,2),
  level          text,
  teacher_comment text,
  generated_at   timestamp with time zone DEFAULT now(),
  UNIQUE(student_id, period_id)
);

-- 4.23 INCIDENTS
CREATE TABLE IF NOT EXISTS public.incidents (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id   bigint REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id   uuid REFERENCES public.profiles(id),
  severity     text CHECK (severity IN ('leve','media','alta')),
  status       text DEFAULT 'received'
               CHECK (status IN ('received','review','resolved','archived')),
  description  text,
  reported_at  timestamp with time zone DEFAULT now() NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.24 DAILY LOGS (Rutina diaria / bitácora)
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id          bigint REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id        bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  date                date DEFAULT current_date,
  mood                text, food text, nap text, eating text, sleeping text,
  activities          text, notes text,
  infant_data         jsonb DEFAULT '[]'::jsonb,
  events              jsonb DEFAULT '[]'::jsonb,
  status              text DEFAULT 'published' CHECK (status IN ('draft','published')),
  school_year_id      bigint REFERENCES public.school_years(id),
  academic_period_id  bigint REFERENCES public.academic_periods(id),
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(student_id, date)
);

-- 4.25 DOOR PUNCHES (Asistencia por QR)
CREATE TABLE IF NOT EXISTS public.door_punches (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id      bigint REFERENCES public.students(id) ON DELETE CASCADE,
  staff_id        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  punch_type      text NOT NULL CHECK (punch_type IN ('check_in','check_out')),
  punched_at      timestamp with time zone DEFAULT now() NOT NULL,
  date            date DEFAULT current_date NOT NULL,
  parent_notified boolean DEFAULT false,
  classroom_id    bigint REFERENCES public.classrooms(id),
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT door_punches_student_type_date UNIQUE (student_id, punch_type, date),
  CONSTRAINT door_punches_staff_type_date   UNIQUE (staff_id, punch_type, date),
  CONSTRAINT door_punches_one_subject CHECK (
    (student_id IS NOT NULL AND staff_id IS NULL) OR
    (student_id IS NULL AND staff_id IS NOT NULL)
  )
);

-- Ensure classroom_id exists even if door_punches was created by older migrations
ALTER TABLE public.door_punches ADD COLUMN IF NOT EXISTS classroom_id bigint REFERENCES public.classrooms(id);

-- 4.26 GALLERY & CLASSROOM CHAT
CREATE TABLE IF NOT EXISTS public.classroom_gallery (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  image_url    text NOT NULL,
  caption      text,
  date         date DEFAULT current_date,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.classroom_chat (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id bigint REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  message      text NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.27 CLASSROOM EVENT SCHEDULE (Timeline de rutina)
CREATE TABLE IF NOT EXISTS public.classroom_event_schedule (
  id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id     bigint REFERENCES public.classrooms(id) ON DELETE CASCADE NOT NULL,
  event_type       text NOT NULL,
  event_label      text NOT NULL,
  event_icon       text DEFAULT '⏰',
  category         text DEFAULT 'personalizados',
  scheduled_hour   smallint NOT NULL CHECK (scheduled_hour >= 0 AND scheduled_hour <= 23),
  scheduled_minute smallint NOT NULL DEFAULT 0 CHECK (scheduled_minute >= 0 AND scheduled_minute <= 59),
  duration_minutes smallint DEFAULT 30 CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  is_active        boolean DEFAULT true,
  auto_register    boolean DEFAULT false,
  applies_to       text DEFAULT 'all' CHECK (applies_to IN ('all','infant','standard')),
  sort_order       smallint DEFAULT 0,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(classroom_id, event_type)
);

CREATE TABLE IF NOT EXISTS public.timeline_event_log (
  id               bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  classroom_id     bigint REFERENCES public.classrooms(id) ON DELETE CASCADE NOT NULL,
  event_type       text NOT NULL,
  registered_by    uuid REFERENCES public.profiles(id),
  target_students  bigint[] DEFAULT '{}',
  student_count    smallint DEFAULT 0,
  scheduled_time   time,
  actual_time      time DEFAULT CURRENT_TIME,
  duration_minutes smallint,
  metadata         jsonb DEFAULT '{}'::jsonb,
  created_at       timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.28 MEETINGS
CREATE TABLE IF NOT EXISTS public.meetings (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  title       text NOT NULL,
  description text,
  room_name   text NOT NULL,
  start_time  timestamp with time zone,
  type        text DEFAULT 'classroom',
  target_id   bigint,
  host_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      text DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.meeting_attendance (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  meeting_id  bigint REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at   timestamp with time zone DEFAULT now(),
  left_at     timestamp with time zone,
  UNIQUE(meeting_id, user_id)
);

-- 4.29 INQUIRIES
CREATE TABLE IF NOT EXISTS public.inquiries (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  parent_id     uuid REFERENCES public.profiles(id) NOT NULL,
  student_id    bigint REFERENCES public.students(id),
  subject       text, message text NOT NULL, response text,
  status        text DEFAULT 'pending', priority text DEFAULT 'medium',
  folio         text, attachment_url text,
  updated_at    timestamp with time zone,
  responded_at  timestamp with time zone,
  created_at    timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.30 SCHOOL SETTINGS
CREATE TABLE IF NOT EXISTS public.school_settings (
  id              int PRIMARY KEY DEFAULT 1,
  phone           text DEFAULT '(829) 803-8424',
  business_hours  text DEFAULT 'Lun-Vie: 7am - 6pm',
  generation_day  int DEFAULT 25,
  due_day         int DEFAULT 5,
  check_in_start  time DEFAULT '07:30:00',
  check_in_end    time DEFAULT '08:30:00',
  check_out_start time DEFAULT '16:00:00',
  check_out_end   time DEFAULT '17:30:00',
  open_time       time DEFAULT '07:00:00',
  close_time      time DEFAULT '18:00:00',
  work_days       text DEFAULT '["Lun","Mar","Mié","Jue","Vie"]',
  updated_at      timestamp with time zone DEFAULT now()
);
INSERT INTO public.school_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 4.31 SYSTEM TABLES
CREATE TABLE IF NOT EXISTS public.system_events (
  id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  type         text NOT NULL, payload jsonb,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  processed_at timestamp with time zone,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.terms_acceptance (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  accepted_at   timestamp with time zone DEFAULT now() NOT NULL,
  terms_version text DEFAULT '1.0' NOT NULL,
  UNIQUE(user_id, terms_version)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action     text NOT NULL,
  payload    jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.data_snapshots (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  type       text NOT NULL,
  data       jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email      text, ip_hash text, success boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_errors (
  id         bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  panel      text,
  context    text,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message    text NOT NULL,
  stack      text,
  url        text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.32 STAFF PERMITS
CREATE TABLE IF NOT EXISTS public.staff_permits (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         permit_type DEFAULT 'permission',
  reason       text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       permit_status DEFAULT 'pending',
  approved_by  uuid REFERENCES public.profiles(id),
  comments     text,
  evidence_url text,
  created_at   timestamp with time zone DEFAULT now(),
  updated_at   timestamp with time zone DEFAULT now()
);

-- 4.33 REPORTS SYSTEM
CREATE TABLE IF NOT EXISTS public.reports (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_number    text UNIQUE NOT NULL,
  reporter_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reporter_role    text NOT NULL,
  target_type      text NOT NULL CHECK (target_type IN ('teacher','parent')),
  target_id        uuid NOT NULL REFERENCES public.profiles(id),
  category         text NOT NULL CHECK (category IN ('conduct','academic','attendance','communication','other')),
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title            text NOT NULL,
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','in_progress','resolved','escalated','closed')),
  required_actions text[],
  follow_up_date   timestamp with time zone,
  resolution_notes text,
  resolved_at      timestamp with time zone,
  resolved_by      uuid REFERENCES public.profiles(id),
  is_confidential  boolean DEFAULT false,
  priority         integer DEFAULT 1 CHECK (priority BETWEEN 1 AND 5),
  tags             text[],
  deleted_at       timestamp with time zone,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.report_history (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id   uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  action      text NOT NULL,
  changed_by  uuid NOT NULL REFERENCES public.profiles(id),
  old_values  jsonb,
  new_values  jsonb,
  comment     text,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.report_attachments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id   uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  file_path   text NOT NULL,
  file_type   text NOT NULL,
  file_size   integer NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  description text,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at  timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.report_actions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id    uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  action_type  text NOT NULL,
  description  text NOT NULL,
  assigned_to  uuid REFERENCES public.profiles(id),
  completed_by uuid REFERENCES public.profiles(id),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','in_progress','completed','cancelled')),
  due_date     timestamp with time zone,
  completed_at timestamp with time zone,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.34 STUDENT HISTORY (nunca se borra)
CREATE TABLE IF NOT EXISTS public.student_history (
  id                  bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id          bigint NOT NULL,
  student_name        text NOT NULL,
  school_year_id      bigint NOT NULL REFERENCES public.school_years(id),
  academic_period_id  bigint REFERENCES public.academic_periods(id),
  classroom_id        bigint REFERENCES public.classrooms(id),
  classroom_name      text,
  teacher_name        text,
  grade_level         text,
  average_score       numeric(5,2),
  attendance_pct      numeric(5,2),
  total_days          integer DEFAULT 0,
  absent_days         integer DEFAULT 0,
  late_days           integer DEFAULT 0,
  status              text DEFAULT 'active'
                      CHECK (status IN ('active','promoted','retained','withdrawn','graduated')),
  notes               text,
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT unique_student_year UNIQUE (student_id, school_year_id)
);

-- 4.35 ENROLLMENTS
CREATE TABLE IF NOT EXISTS public.enrollments (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  student_id     bigint REFERENCES public.students(id) ON DELETE SET NULL,
  school_year_id bigint NOT NULL REFERENCES public.school_years(id),
  type           text NOT NULL CHECK (type IN ('new','reenrollment')),
  classroom_id   bigint REFERENCES public.classrooms(id),
  parent_id      uuid REFERENCES public.profiles(id),
  student_name   text,
  status         text DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
  enrolled_at    timestamp with time zone,
  approved_by    uuid REFERENCES public.profiles(id),
  notes          text,
  created_at     timestamp with time zone DEFAULT now() NOT NULL
);

-- 4.36 PROMOTION RULES
CREATE TABLE IF NOT EXISTS public.promotion_rules (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  school_year_id  bigint NOT NULL REFERENCES public.school_years(id) ON DELETE CASCADE,
  from_grade      text NOT NULL,
  to_grade        text NOT NULL,
  min_average     numeric(5,2) DEFAULT 70.00,
  min_attendance  numeric(5,2) DEFAULT 80.00,
  auto_promote    boolean DEFAULT true,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT unique_promotion_rule UNIQUE (school_year_id, from_grade)
);

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 5: DATOS INICIALES DE MATERIAS
-- ══════════════════════════════════════════════════════════════
INSERT INTO public.subjects (name, education_level, description) VALUES
  ('Desarrollo Socioemocional', 'estancia',   'Habilidades socioemocionales'),
  ('Psicomotricidad',           'estancia',   'Desarrollo motor grueso y fino'),
  ('Lenguaje',                  'estancia',   'Expresión y comprensión verbal'),
  ('Descubrimiento del Entorno','estancia',   'Exploración del mundo'),
  ('Arte y Creatividad',        'estancia',   'Expresión artística'),
  ('Inglés',                    'estancia',   'Introducción al inglés'),
  ('Lenguaje y Comunicación',   'preescolar', 'Lectura, escritura y comprensión'),
  ('Pensamiento Matemático',    'preescolar', 'Números y lógica'),
  ('Exploración y Conocimiento','preescolar', 'Ciencias naturales y sociales'),
  ('Desarrollo Socioemocional', 'preescolar', 'Convivencia y autoestima'),
  ('Arte y Expresión',          'preescolar', 'Arte, música y dramatización'),
  ('Formación Cívica y Ética',  'preescolar', 'Valores y ciudadanía'),
  ('Educación Física',          'preescolar', 'Actividad física y salud'),
  ('Español',                   'primaria',   'Lengua y literatura'),
  ('Matemáticas',               'primaria',   'Aritmética, álgebra y geometría'),
  ('Ciencias Naturales',        'primaria',   'Biología, química y física básica'),
  ('Ciencias Sociales',         'primaria',   'Historia, geografía y sociedad'),
  ('Inglés',                    'primaria',   'English as a second language'),
  ('Formación Cívica y Ética',  'primaria',   'Valores y derechos'),
  ('Educación Física',          'primaria',   'Deporte y condición física'),
  ('Arte',                      'primaria',   'Artes visuales, música y teatro'),
  ('Tecnología',                'primaria',   'Herramientas digitales')
ON CONFLICT (name) DO NOTHING;

-- Admin inicial
INSERT INTO public.profiles (id, email, name, role, accepted_terms, created_at)
VALUES ('c1e72617-ab8f-44c0-b1eb-cdd92eda62e7', 'impulsodigital@gmail.com', 'Administrador', 'admin', true, now())
ON CONFLICT (id) DO UPDATE SET role = 'admin', accepted_terms = true;

-- ══════════════════════════════════════════════════════════════
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

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_period              ON public.tasks (period_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_tasks_classroom_id        ON public.tasks (classroom_id);
CREATE INDEX IF NOT EXISTS idx_tasks_classroom_date      ON public.tasks (classroom_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_school_year         ON public.tasks (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_evidences_task_id    ON public.task_evidences (task_id);
CREATE INDEX IF NOT EXISTS idx_task_evidences_student_id ON public.task_evidences (student_id);
CREATE INDEX IF NOT EXISTS idx_task_evidences_task_status ON public.task_evidences (task_id, status);

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
CREATE POLICY "evidences_all" ON public.task_evidences FOR ALL
  USING (auth.uid() IS NOT NULL);

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

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 9: FUNCIONES UTILITARIAS
-- ══════════════════════════════════════════════════════════════

-- set_updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- handle_new_user (auth trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, accepted_terms)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role','padre'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- update_post_comments_count
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id; RETURN OLD;
  END IF; RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS on_comment_change ON public.comments;
CREATE TRIGGER on_comment_change AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.update_post_comments_count();

-- update_post_likes_count
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id; RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id; RETURN OLD;
  END IF; RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS on_like_change ON public.likes;
CREATE TRIGGER on_like_change AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();

-- handle_new_post_teacher_info
CREATE OR REPLACE FUNCTION public.handle_new_post_teacher_info()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    NEW.teacher_name   := (SELECT name       FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
    NEW.teacher_avatar := (SELECT avatar_url FROM public.profiles WHERE id = NEW.teacher_id LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_new_post_populate_teacher ON public.posts;
CREATE TRIGGER on_new_post_populate_teacher BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_post_teacher_info();

-- send_notification (overloads)
CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text, p_data jsonb DEFAULT '{}', p_link text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, p_link, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.send_notification(p_user_id uuid, p_type text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, is_read, created_at)
  VALUES (p_user_id, p_type, p_message, p_type, false, now()) ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text) TO authenticated;

-- is_email_under_attack
CREATE OR REPLACE FUNCTION public.is_email_under_attack(p_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) >= 10 FROM public.login_attempts
  WHERE email = p_email AND success = false AND created_at > NOW() - INTERVAL '1 hour';
$$;
GRANT EXECUTE ON FUNCTION public.is_email_under_attack(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 10: FUNCIÓN MORA (Centralizada v2)
-- Regla: bloques de 7 días × RD$500 + días restantes × RD$50
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.calculate_mora_v2(p_amount numeric, p_due_date date, p_status text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_days_late int;
  v_bloques int;
  v_dias_restantes int;
BEGIN
  IF p_status = 'paid' OR p_status = 'rejected' OR p_due_date IS NULL OR p_due_date >= CURRENT_DATE THEN
    RETURN 0;
  END IF;
  v_days_late := (CURRENT_DATE - p_due_date)::int;
  v_bloques := FLOOR(v_days_late / 7);
  v_dias_restantes := v_days_late % 7;
  RETURN (v_bloques * 500) + (v_dias_restantes * 50);
END;
$$;

-- Alias corto
CREATE OR REPLACE FUNCTION public.calc_mora(p_due_date date)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_days_late int; v_bloques int; v_resto int;
BEGIN
  v_days_late := (CURRENT_DATE - p_due_date)::int;
  IF v_days_late <= 0 THEN RETURN 0; END IF;
  v_bloques := v_days_late / 7;
  v_resto   := v_days_late % 7;
  RETURN (v_bloques * 500) + (v_resto * 50);
END;
$$;

-- Vista con mora
DROP VIEW IF EXISTS public.v_payments_with_mora;
CREATE VIEW public.v_payments_with_mora AS
SELECT
  p.*,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS mora_amount,
  public.calculate_mora_v2(p.amount, p.due_date, p.status) AS calculated_mora,
  (p.amount + public.calculate_mora_v2(p.amount, p.due_date, p.status)) AS total_due,
  (CURRENT_DATE - p.due_date)::int AS days_late,
  s.name          AS student_name,
  s.p1_name       AS parent_name,
  s.p1_email      AS parent_email,
  s.p1_phone      AS parent_phone,
  s.p2_name       AS parent2_name,
  s.p2_email      AS parent2_email,
  s.p2_phone      AS parent2_phone,
  c.name          AS classroom_name,
  ap.name         AS approved_by_name
FROM public.payments p
LEFT JOIN public.students  s  ON s.id = p.student_id
LEFT JOIN public.classrooms c ON c.id = s.classroom_id
LEFT JOIN public.profiles  ap ON ap.id = p.validated_by
WHERE p.deleted_at IS NULL;
GRANT SELECT ON public.v_payments_with_mora TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 11: CICLO DE PAGOS (run_payment_cycle con regla de gracia)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role          text;
  v_gen_day       int;
  v_due_day       int;
  v_now           date := current_date;
  v_target_month  text;
  v_due_date      date;
  v_generated     int := 0;
  v_expired       int := 0;
  v_student       record;
  v_start_day     int;
  v_first_billing text;
  v_first_m       int;
  v_first_y       int;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RAISE EXCEPTION 'Acceso denegado: solo directora/asistente/admin pueden ejecutar el ciclo de pagos';
  END IF;

  SELECT COALESCE(generation_day,25), COALESCE(due_day,5) INTO v_gen_day, v_due_day
  FROM public.school_settings WHERE id = 1;

  v_target_month := to_char(v_now + interval '1 month', 'YYYY-MM');
  v_due_date     := (date_trunc('month', v_now + interval '2 months') + (v_due_day - 1) * interval '1 day')::date;

  FOR v_student IN
    SELECT s.id, s.monthly_fee, s.prolongado_fee, s.start_date
    FROM public.students s
    WHERE s.is_active = true AND s.monthly_fee > 0 AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.student_id = s.id AND p.month_paid = v_target_month AND p.concept = 'Mensualidad' AND p.deleted_at IS NULL
      )
  LOOP
    IF v_student.start_date IS NOT NULL THEN
      v_start_day := EXTRACT(DAY FROM v_student.start_date)::int;
      IF v_start_day < v_gen_day THEN
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m = 12 THEN v_first_m := 1; v_first_y := v_first_y + 1;
        ELSE v_first_m := v_first_m + 1; END IF;
      ELSE
        v_first_m := EXTRACT(MONTH FROM v_student.start_date)::int + 2;
        v_first_y := EXTRACT(YEAR FROM v_student.start_date)::int;
        IF v_first_m > 12 THEN v_first_m := v_first_m - 12; v_first_y := v_first_y + 1; END IF;
      END IF;
      v_first_billing := v_first_y || '-' || LPAD(v_first_m::text, 2, '0');
      IF v_target_month < v_first_billing THEN CONTINUE; END IF;
    END IF;

    INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
    VALUES (v_student.id, v_student.monthly_fee, 'pending', v_due_date, v_target_month, 'Mensualidad', now())
    ON CONFLICT DO NOTHING;
    v_generated := v_generated + 1;

    IF v_student.prolongado_fee > 0 THEN
      INSERT INTO public.payments (student_id, amount, status, due_date, month_paid, concept, created_at)
      VALUES (v_student.id, v_student.prolongado_fee, 'pending', v_due_date, v_target_month, 'Día Prolongado', now())
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.payments SET status = 'overdue', updated_at = now()
  WHERE status = 'pending' AND due_date < v_now AND deleted_at IS NULL;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object('generated', v_generated, 'expired', v_expired, 'month', v_target_month, 'due_date', v_due_date::text);
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_payment_cycle() TO authenticated;

-- preview_payment_cycle
CREATE OR REPLACE FUNCTION public.preview_payment_cycle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_target_month text; v_gen_count int := 0; v_total_amount numeric := 0;
  v_grace_count int := 0; v_existing_count int := 0;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  v_target_month := to_char(current_date + interval '1 month', 'YYYY-MM');
  SELECT count(*), coalesce(sum(monthly_fee + prolongado_fee),0)
  INTO v_gen_count, v_total_amount
  FROM public.students WHERE is_active = true AND monthly_fee > 0
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.student_id = students.id AND p.month_paid = v_target_month AND p.deleted_at IS NULL);
  SELECT count(DISTINCT student_id) INTO v_existing_count
  FROM public.payments WHERE month_paid = v_target_month AND deleted_at IS NULL;
  RETURN jsonb_build_object('target_month', v_target_month, 'count', v_gen_count,
    'total_amount', v_total_amount, 'existing_count', v_existing_count);
END;
$$;

-- check_payment_cycle_health
CREATE OR REPLACE FUNCTION public.check_payment_cycle_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_gen_day int; v_today int := extract(day from current_date)::int;
  v_month_key text; v_has_payments boolean;
BEGIN
  SELECT COALESCE(generation_day,25) INTO v_gen_day FROM public.school_settings WHERE id = 1;
  IF v_today < v_gen_day THEN
    RETURN jsonb_build_object('status','ok','message','Aún no llega el día de generación');
  END IF;
  v_month_key := to_char(current_date + interval '1 month', 'YYYY-MM');
  SELECT EXISTS (SELECT 1 FROM public.payments WHERE month_paid = v_month_key AND concept = 'Mensualidad' AND deleted_at IS NULL)
  INTO v_has_payments;
  IF v_has_payments THEN RETURN jsonb_build_object('status','ok','message','Ciclo ejecutado correctamente');
  ELSE RETURN jsonb_build_object('status','error','message','El ciclo de pagos no se ha ejecutado todavía'); END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.preview_payment_cycle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_payment_cycle_health() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 12: PAGOS — approve, delete, waive, reset, annual
-- ══════════════════════════════════════════════════════════════

-- approve_payment (requiere comprobante para transferencias)
CREATE OR REPLACE FUNCTION public.approve_payment(p_payment_id bigint, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text; v_payment record; has_proof boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN
    RETURN jsonb_build_object('error','No tienes permisos para aprobar pagos');
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','El pago no existe'); END IF;
  IF v_payment.status = 'paid' THEN RETURN jsonb_build_object('error','El pago ya fue aprobado'); END IF;
  has_proof := (v_payment.proof_url IS NOT NULL AND v_payment.proof_url <> '') OR
               (v_payment.evidence_url IS NOT NULL AND v_payment.evidence_url <> '');
  IF NOT has_proof AND (v_payment.method IS DISTINCT FROM 'efectivo') THEN
    RETURN jsonb_build_object('error','No se puede aprobar una transferencia sin comprobante cargado');
  END IF;
  UPDATE public.payments
  SET status='paid', paid_date=now(), validated_by=auth.uid(), notes=COALESCE(p_notes,notes,'Aprobado vía sistema')
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'approved_by',auth.uid(),'approved_at',now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_payment(bigint, text) TO authenticated;

-- delete_payment (soft delete)
CREATE OR REPLACE FUNCTION public.delete_payment(p_payment_id bigint, p_reason text DEFAULT 'Eliminado por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','asistente','admin') THEN RETURN jsonb_build_object('error','No autorizado'); END IF;
  UPDATE public.payments SET deleted_at=now(), notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY HH24:MI')||')'
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_payment(bigint, text) TO authenticated;

-- waive_payment_mora
CREATE OR REPLACE FUNCTION public.waive_payment_mora(p_payment_id bigint, p_reason text DEFAULT 'Mora exonerada por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  UPDATE public.payments SET due_date=CURRENT_DATE, last_reminder_sent=NULL,
    notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY')||')'
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id,'new_due_date',CURRENT_DATE);
END;
$$;
GRANT EXECUTE ON FUNCTION public.waive_payment_mora(bigint, text) TO authenticated;

-- reset_payment_to_pending
CREATE OR REPLACE FUNCTION public.reset_payment_to_pending(p_payment_id bigint, p_reason text DEFAULT 'Reiniciado por administración')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payments SET status='pending', due_date=CURRENT_DATE+INTERVAL '7 days', last_reminder_sent=NULL,
    notes=COALESCE(notes||' | ','')||p_reason||' ('||to_char(now(),'DD/MM/YYYY')||')'
  WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Pago no encontrado'); END IF;
  RETURN jsonb_build_object('success',true,'payment_id',p_payment_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_payment_to_pending(bigint, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 13: ASISTENCIA — process_door_punch (versión final)
-- Incluye: zona horaria RD, validación código, student_id en respuesta
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_door_punch(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student  record; v_staff record; v_settings record;
  v_today    date := (now() AT TIME ZONE 'America/Santo_Domingo')::date;
  v_now      timestamp with time zone := now();
  v_local_time time := (now() AT TIME ZONE 'America/Santo_Domingo')::time;
  v_type     text; v_name text; v_role text; v_parent uuid;
  v_existing record; v_attendance record; v_status text := 'present';
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) < 3 THEN
    RETURN jsonb_build_object('success',false,'message','Código QR inválido');
  END IF;

  SELECT * INTO v_student FROM public.students WHERE matricula = trim(p_code) AND is_active = true LIMIT 1;
  IF FOUND THEN
    v_name := v_student.name; v_role := 'Estudiante'; v_parent := v_student.parent_id;
    SELECT * INTO v_settings FROM public.school_settings WHERE id = 1;
    SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      IF v_settings.check_in_end IS NOT NULL AND v_local_time > v_settings.check_in_end THEN v_status := 'late'; END IF;
      SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
      IF v_attendance.id IS NULL THEN
        INSERT INTO public.attendance (student_id, classroom_id, date, status, check_in)
        VALUES (v_student.id, v_student.classroom_id, v_today, v_status, v_now);
      ELSE
        UPDATE public.attendance SET status = v_status, check_in = v_now WHERE id = v_attendance.id;
      END IF;
      INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE student_id = v_student.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out'; v_status := 'retirado';
        SELECT * INTO v_attendance FROM public.attendance WHERE student_id = v_student.id AND date = v_today;
        IF v_attendance.id IS NOT NULL THEN UPDATE public.attendance SET check_out = v_now, status = 'retirado' WHERE id = v_attendance.id; END IF;
        INSERT INTO public.door_punches (student_id, punch_type, punched_at, date) VALUES (v_student.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status',v_status,
      'student_id',v_student.id,'parent_id',v_parent,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;

  SELECT * INTO v_staff FROM public.profiles
  WHERE (notes=trim(p_code) OR matricula=trim(p_code) OR access_code=trim(p_code))
    AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
  IF NOT FOUND THEN
    BEGIN SELECT * INTO v_staff FROM public.profiles WHERE id=trim(p_code)::uuid AND role IN ('maestra','asistente','directora','admin') LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF FOUND THEN
    v_name := v_staff.name; v_role := initcap(v_staff.role);
    SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_in';
    IF NOT FOUND THEN
      v_type := 'check_in';
      INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_in',v_now,v_today) ON CONFLICT DO NOTHING;
    ELSE
      SELECT * INTO v_existing FROM public.door_punches WHERE staff_id = v_staff.id AND date = v_today AND punch_type = 'check_out';
      IF NOT FOUND THEN
        v_type := 'check_out';
        INSERT INTO public.door_punches (staff_id, punch_type, punched_at, date) VALUES (v_staff.id,'check_out',v_now,v_today) ON CONFLICT DO NOTHING;
      ELSE
        RETURN jsonb_build_object('success',false,'message',v_name||' ya registró entrada y salida hoy');
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'type',v_type,'name',v_name,'role',v_role,'status','present',
      'student_id',null,'parent_id',null,'time',to_char(v_now AT TIME ZONE 'America/Santo_Domingo','HH12:MI AM'));
  END IF;
  RETURN jsonb_build_object('success',false,'message','QR no registrado en el sistema');
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_door_punch(text) TO anon;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 14: CHAT — find_or_create, get_direct_messages, mark_read, unread_counts
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_or_create_private_conversation(p_user1 uuid, p_user2 uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv_id bigint;
BEGIN
  SELECT cp1.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id AND cp2.user_id = p_user2
  JOIN public.conversations c ON c.id = cp1.conversation_id AND c.type = 'direct_message'
  WHERE cp1.user_id = p_user1 LIMIT 1;
  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;
  INSERT INTO public.conversations (type) VALUES ('direct_message') RETURNING id INTO v_conv_id;
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (v_conv_id,p_user1),(v_conv_id,p_user2) ON CONFLICT DO NOTHING;
  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_or_create_private_conversation(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_direct_messages(p_other_user_id uuid)
RETURNS TABLE (
  id              bigint, content text, sender_id uuid, created_at timestamp with time zone,
  is_read boolean, conversation_id bigint, sender_name text, sender_avatar text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.content, m.sender_id, m.created_at, m.is_read, m.conversation_id,
         p.name AS sender_name, p.avatar_url AS sender_avatar
  FROM public.messages m
  LEFT JOIN public.profiles p ON m.sender_id = p.id
  WHERE m.conversation_id = (
    SELECT c.id FROM public.conversations c
    WHERE c.type IN ('direct_message','private')
      AND EXISTS (SELECT 1 FROM public.conversation_participants x WHERE x.conversation_id = c.id AND x.user_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.conversation_participants y WHERE y.conversation_id = c.id AND y.user_id = p_other_user_id)
    LIMIT 1
  )
  ORDER BY m.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_direct_messages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_my_id uuid := auth.uid();
BEGIN
  IF v_my_id IS NULL OR p_conversation_id IS NULL THEN RETURN; END IF;
  UPDATE public.messages SET is_read = true
  WHERE conversation_id = p_conversation_id AND sender_id <> v_my_id AND (is_read IS NULL OR is_read = false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(bigint) TO authenticated;

-- get_unread_counts — devuelve mapa sender_id → count + total
CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result  jsonb := '{}'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN v_result; END IF;
  SELECT jsonb_object_agg(m.sender_id, m.count) INTO v_result
  FROM (
    SELECT m.sender_id, count(*) AS count
    FROM public.messages m
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = v_user_id
    WHERE m.sender_id <> v_user_id AND m.is_read = false
    GROUP BY m.sender_id
  ) m;
  v_result := jsonb_set(
    COALESCE(v_result,'{}'),'{total}',
    to_jsonb(COALESCE((SELECT sum(count::int) FROM jsonb_each_text(COALESCE(v_result,'{}')) AS t(key,count)),0))
  );
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('total',0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 15: PERÍODOS — get_current_period, get_active_period, activate_period
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_current_period()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period periods%ROWTYPE;
BEGIN
  SELECT * INTO v_period FROM public.periods WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN SELECT * INTO v_period FROM public.periods WHERE status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
  RETURN jsonb_build_object('found',true,'id',v_period.id,'name',v_period.name,'status',v_period.status,
    'is_active',v_period.is_active,'start_date',v_period.start_date,'end_date',v_period.end_date,'classroom_id',v_period.classroom_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_current_period() TO authenticated;

-- get_active_period — busca en academic_periods primero, fallback a legacy periods
CREATE OR REPLACE FUNCTION public.get_active_period(p_classroom_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_ap record; v_p record;
BEGIN
  SELECT ap.*, sy.name AS school_year_name INTO v_ap
  FROM public.academic_periods ap
  JOIN public.school_years sy ON sy.id = ap.school_year_id
  WHERE ap.is_active = true AND ap.status = 'open'
    AND sy.status IN ('active','enrollment','reenrollment')
  ORDER BY ap.order_index LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('found',true,'id',v_ap.id,'name',v_ap.name,'start_date',v_ap.start_date,
      'end_date',v_ap.end_date,'status',v_ap.status,'is_active',v_ap.is_active,
      'school_year_id',v_ap.school_year_id,'school_year_name',v_ap.school_year_name,
      'order_index',v_ap.order_index,'source','academic_periods');
  END IF;
  IF p_classroom_id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.periods
    WHERE classroom_id = p_classroom_id AND status = 'open' AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_p FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1;
    END IF;
    IF FOUND THEN
      RETURN jsonb_build_object('found',true,'id',v_p.id,'name',v_p.name,'start_date',v_p.start_date,
        'end_date',v_p.end_date,'status',v_p.status,'is_active',v_p.is_active,'classroom_id',v_p.classroom_id,'source','periods');
    END IF;
  END IF;
  RETURN jsonb_build_object('found',false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_period(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_role text; v_period periods%ROWTYPE; v_old_id bigint;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo la directora puede activar períodos'); END IF;
  SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  SELECT id INTO v_old_id FROM public.periods WHERE is_active = true LIMIT 1;
  UPDATE public.periods SET is_active = false WHERE classroom_id = v_period.classroom_id OR classroom_id IS NULL;
  UPDATE public.periods SET is_active = true, status = 'open' WHERE id = p_period_id;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at)
  VALUES (v_user_id,'period.activated',jsonb_build_object('new_period_id',p_period_id,'old_period_id',v_old_id),now());
  RETURN jsonb_build_object('success',true,'period_id',p_period_id,'period_name',v_period.name,'old_period_id',v_old_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_period(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 16: CIERRE DE PERÍODO con calificaciones V2
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.close_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period        periods%ROWTYPE;
  v_ap_period     academic_periods%ROWTYPE;
  v_user_id       uuid; v_role text;
  v_student       record; v_config record;
  v_subject_avg   numeric(5,2); v_method text;
  v_total_avg     numeric(5,2); v_subject_count int;
  v_cards_created int := 0; v_level text;
  v_next_period   record;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('directora','admin') THEN
    RETURN jsonb_build_object('error','Solo la directora puede cerrar períodos');
  END IF;

  -- Determinar si es academic_period o legacy period
  SELECT * INTO v_ap_period FROM public.academic_periods WHERE id = p_period_id;
  IF FOUND THEN
    IF v_ap_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.academic_periods SET status='closed', is_active=false WHERE id = p_period_id;
    SELECT * INTO v_next_period FROM public.academic_periods
    WHERE school_year_id = v_ap_period.school_year_id AND order_index = v_ap_period.order_index + 1;
  ELSE
    SELECT * INTO v_period FROM public.periods WHERE id = p_period_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
    IF v_period.status = 'closed' THEN RETURN jsonb_build_object('error','El período ya está cerrado'); END IF;
    UPDATE public.periods SET status='closed', is_active=false WHERE id = p_period_id;
  END IF;

  -- Calcular calificaciones por materia V2
  FOR v_student IN
    SELECT s.id AS student_id, s.classroom_id
    FROM public.students s
    WHERE s.classroom_id = COALESCE(v_period.classroom_id, v_ap_period.id) AND s.is_active = true
  LOOP
    v_total_avg := 0; v_subject_count := 0;
    FOR v_config IN
      SELECT pc.id AS config_id, pc.subject_id, s.name AS subject_name
      FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id
      WHERE pc.period_id = p_period_id
    LOOP
      SELECT COUNT(*)::text INTO v_method
      FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
      WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL;
      IF v_method::int >= 5 THEN v_method := 'best_5'; ELSE v_method := 'all'; END IF;
      IF v_method = 'best_5' THEN
        SELECT ROUND(AVG(score_v2),2) INTO v_subject_avg FROM (
          SELECT g.score_v2 FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
          WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL
          ORDER BY g.score_v2 DESC LIMIT 5) best;
      ELSE
        SELECT ROUND(AVG(g.score_v2),2) INTO v_subject_avg FROM public.grades g
        JOIN public.activities a ON a.id = g.activity_id
        WHERE a.config_id = v_config.config_id AND g.student_id = v_student.student_id AND g.score_v2 IS NOT NULL;
      END IF;
      IF v_subject_avg IS NOT NULL THEN
        INSERT INTO public.subject_averages (student_id, period_id, subject_id, average, graded_count, method)
        VALUES (v_student.student_id, p_period_id, v_config.subject_id, v_subject_avg, v_method::int,
          CASE WHEN v_method='best_5' THEN 'best_5' ELSE 'all' END)
        ON CONFLICT (student_id, period_id, subject_id) DO UPDATE SET
          average=EXCLUDED.average, graded_count=EXCLUDED.graded_count, method=EXCLUDED.method;
        v_total_avg := v_total_avg + v_subject_avg; v_subject_count := v_subject_count + 1;
      END IF;
    END LOOP;
    IF v_subject_count > 0 THEN v_total_avg := ROUND(v_total_avg / v_subject_count,2); ELSE v_total_avg := NULL; END IF;
    v_level := CASE WHEN v_total_avg IS NULL THEN 'Sin calificar'
                    WHEN v_total_avg >= 90 THEN 'Excelente'
                    WHEN v_total_avg >= 80 THEN 'Bueno'
                    WHEN v_total_avg >= 70 THEN 'En proceso'
                    ELSE 'Requiere apoyo' END;
    INSERT INTO public.report_cards (student_id, classroom_id, period_id, task_avg, formal_avg, final_score, level, generated_at)
    VALUES (v_student.student_id, v_student.classroom_id, p_period_id, v_total_avg, v_total_avg, v_total_avg, v_level, now())
    ON CONFLICT (student_id, period_id) DO UPDATE SET
      task_avg=EXCLUDED.task_avg, formal_avg=EXCLUDED.formal_avg, final_score=EXCLUDED.final_score,
      level=EXCLUDED.level, generated_at=now();
    v_cards_created := v_cards_created + 1;
  END LOOP;

  -- Avanzar al siguiente período o cerrar año
  IF v_next_period.id IS NOT NULL THEN
    UPDATE public.academic_periods SET status='open', is_active=true WHERE id = v_next_period.id;
    RETURN jsonb_build_object('success',true,'message','Período cerrado. Abierto: '||v_next_period.name,
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'opened_period',v_next_period.name,
      'next_period_id',v_next_period.id,'cards_generated',v_cards_created);
  ELSE
    IF v_ap_period.school_year_id IS NOT NULL THEN
      UPDATE public.school_years SET status='closed', updated_at=now() WHERE id = v_ap_period.school_year_id;
    END IF;
    RETURN jsonb_build_object('success',true,'message','Último período cerrado. Año escolar cerrado.',
      'closed_period',COALESCE(v_ap_period.name,v_period.name),'year_closed',true,'cards_generated',v_cards_created);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_period(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 17: AÑO ESCOLAR — get_active_school_year, get/advance_school_year_status
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_school_year()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'status',status,
    'enrollment_start',enrollment_start,'enrollment_end',enrollment_end,
    'reenrollment_start',reenrollment_start,'reenrollment_end',reenrollment_end)
  INTO v_result FROM public.school_years
  WHERE status IN ('active','enrollment','reenrollment')
  ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'enrollment' THEN 2 WHEN 'reenrollment' THEN 3 END LIMIT 1;
  RETURN COALESCE(v_result,'{}');
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_school_year() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_school_year_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_year record; v_today date := CURRENT_DATE;
  v_enrollment_open boolean := false; v_reenrollment_open boolean := false;
  v_active_period jsonb; v_days_remaining integer; v_ap_count int;
BEGIN
  SELECT * INTO v_year FROM public.school_years WHERE status IN ('active','enrollment','reenrollment') LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_year FROM public.school_years WHERE status = 'draft' ORDER BY id DESC LIMIT 1;
    IF FOUND THEN UPDATE public.school_years SET status='active', updated_at=now() WHERE id = v_year.id; END IF;
  END IF;
  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_ap_count FROM public.academic_periods;
    IF v_ap_count > 0 THEN RETURN jsonb_build_object('has_active_year',false,'status','orphan_periods','orphan_count',v_ap_count); END IF;
    RETURN jsonb_build_object('has_active_year',false,'status','none','message','No hay año escolar configurado');
  END IF;
  IF v_year.enrollment_start IS NOT NULL AND v_year.enrollment_end IS NOT NULL THEN
    v_enrollment_open := v_today BETWEEN v_year.enrollment_start AND v_year.enrollment_end;
  END IF;
  IF v_year.reenrollment_start IS NOT NULL AND v_year.reenrollment_end IS NOT NULL THEN
    v_reenrollment_open := v_today BETWEEN v_year.reenrollment_start AND v_year.reenrollment_end;
  END IF;
  v_active_period := public.get_active_period();
  v_days_remaining := GREATEST(0,(v_year.end_date - v_today)::int);
  RETURN jsonb_build_object(
    'has_active_year',true,'school_year_id',v_year.id,'school_year_name',v_year.name,
    'status',v_year.status,'start_date',v_year.start_date,'end_date',v_year.end_date,
    'enrollment_open',v_enrollment_open,'enrollment_window',jsonb_build_object('start',v_year.enrollment_start,'end',v_year.enrollment_end),
    'reenrollment_open',v_reenrollment_open,'reenrollment_window',jsonb_build_object('start',v_year.reenrollment_start,'end',v_year.reenrollment_end),
    'active_period',v_active_period,'days_remaining',v_days_remaining,
    'is_school_time',v_year.status = 'active' AND v_today BETWEEN v_year.start_date AND v_year.end_date
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_school_year_status() TO authenticated;

-- create_school_year / update_school_year
CREATE OR REPLACE FUNCTION public.create_school_year(
  p_name text, p_start_date date, p_end_date date,
  p_enrollment_start date DEFAULT NULL, p_enrollment_end date DEFAULT NULL,
  p_reenrollment_start date DEFAULT NULL, p_reenrollment_end date DEFAULT NULL,
  p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_status text; v_row public.school_years%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','admin') THEN RETURN jsonb_build_object('error','Solo directora o admin pueden crear años escolares'); END IF;
  v_status := COALESCE(p_status, CASE WHEN p_enrollment_start IS NOT NULL THEN 'draft' ELSE 'active' END);
  INSERT INTO public.school_years (name, start_date, end_date, enrollment_start, enrollment_end, reenrollment_start, reenrollment_end, status, created_by)
  VALUES (p_name, p_start_date, p_end_date, p_enrollment_start, p_enrollment_end, p_reenrollment_start, p_reenrollment_end, v_status, auth.uid())
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status,'created_at',v_row.created_at);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_school_year(text,date,date,date,date,date,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_academic_period(
  p_school_year_id bigint, p_name text, p_start_date date, p_end_date date,
  p_order_index integer, p_status text DEFAULT 'pending', p_is_active boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_row public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  INSERT INTO public.academic_periods (school_year_id, name, start_date, end_date, order_index, status, is_active)
  VALUES (p_school_year_id, p_name, p_start_date, p_end_date, p_order_index, p_status, p_is_active) RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_academic_period(bigint,text,date,date,integer,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_academic_period(p_period_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_period public.academic_periods%ROWTYPE;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('directora','maestra','asistente','admin') THEN RETURN jsonb_build_object('error','Sin permisos'); END IF;
  SELECT * INTO v_period FROM public.academic_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Período no encontrado'); END IF;
  UPDATE public.academic_periods SET is_active=false WHERE school_year_id = v_period.school_year_id;
  UPDATE public.academic_periods SET is_active=true, status='open' WHERE id = p_period_id;
  RETURN jsonb_build_object('success',true,'id',v_period.id,'name',v_period.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.activate_academic_period(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 18: CALIFICACIONES — get_tasks_for_period, get_posts_for_period,
--             get_period_config, get_activities_with_grades, get_student_grades_v2,
--             get_student_subject_averages, get_student_history
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_tasks_for_period(p_classroom_id bigint, p_period_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'due_date',t.due_date,
    'file_url',t.file_url,'grading_system',t.grading_system,'classroom_id',t.classroom_id,'period_id',t.period_id,'created_at',t.created_at)
    ORDER BY t.due_date ASC) INTO v_result
  FROM public.tasks t
  WHERE t.classroom_id = p_classroom_id
    AND (v_period_id IS NULL OR t.period_id = v_period_id OR
      (t.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods p WHERE p.id = v_period_id AND t.created_at BETWEEN p.start_date AND p.end_date + INTERVAL '1 day')));
  RETURN jsonb_build_object('tasks',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tasks_for_period(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_posts_for_period(
  p_classroom_id bigint DEFAULT NULL, p_period_id bigint DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period_id bigint := p_period_id; v_result jsonb;
BEGIN
  IF v_period_id IS NULL AND p_classroom_id IS NOT NULL THEN
    SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    IF v_period_id IS NULL THEN SELECT id INTO v_period_id FROM public.periods WHERE classroom_id = p_classroom_id AND status = 'open' ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',p.id,'content',p.content,'media_url',p.media_url,'media_type',p.media_type,
    'image_url',p.image_url,'created_at',p.created_at,'classroom_id',p.classroom_id,'teacher_id',p.teacher_id,'period_id',p.period_id,
    'teacher',jsonb_build_object('name',COALESCE(pr.name,p.teacher_name,'Maestra'),'avatar_url',COALESCE(pr.avatar_url,p.teacher_avatar),'role',pr.role),
    'likes',COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',l.user_id,'id',l.id)) FROM public.likes l WHERE l.post_id = p.id),'[]'),
    'comments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'content',c.content,'user_name',c.user_name,'user_id',c.user_id,'created_at',c.created_at) ORDER BY c.created_at) FROM public.comments c WHERE c.post_id = p.id),'[]'))
    ORDER BY p.created_at DESC) INTO v_result
  FROM public.posts p
  LEFT JOIN public.profiles pr ON pr.id = p.teacher_id
  WHERE (p.classroom_id = p_classroom_id OR p.classroom_id IS NULL)
    AND (v_period_id IS NULL OR p.period_id = v_period_id OR
      (p.period_id IS NULL AND v_period_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.periods per WHERE per.id = v_period_id AND p.created_at BETWEEN per.start_date AND per.end_date + INTERVAL '1 day')))
  LIMIT p_limit;
  RETURN jsonb_build_object('posts',COALESCE(v_result,'[]'),'period_id',v_period_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_posts_for_period(bigint, bigint, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_period_config(p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pc.id,'subject_id',pc.subject_id,'subject_name',s.name,
    'education_level',s.education_level,'activity_count',pc.activity_count) ORDER BY s.name),'[]')
  FROM public.period_config pc JOIN public.subjects s ON s.id = pc.subject_id WHERE pc.period_id = p_period_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_period_config(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_grades_v2(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('activity_id',g.activity_id,'score',g.score_v2,
    'subject_name',s.name,'activity_title',a.title,'activity_number',a.activity_number,'comment',g.notes)
    ORDER BY s.name, a.activity_number),'[]')
  FROM public.grades g JOIN public.activities a ON a.id = g.activity_id
  JOIN public.period_config pc ON pc.id = a.config_id JOIN public.subjects s ON s.id = pc.subject_id
  WHERE g.student_id = p_student_id AND pc.period_id = p_period_id AND g.score_v2 IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_grades_v2(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_subject_averages(p_student_id bigint, p_period_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('subject_name',s.name,'average',sa.average,
    'graded_count',sa.graded_count,'method',sa.method) ORDER BY s.name),'[]')
  FROM public.subject_averages sa JOIN public.subjects s ON s.id = sa.subject_id
  WHERE sa.student_id = p_student_id AND sa.period_id = p_period_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_subject_averages(bigint, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_history(p_student_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_name',p.name,'classroom_name',c.name,
    'task_avg',rc.task_avg,'formal_avg',rc.formal_avg,'final_score',rc.final_score,
    'level',rc.level,'teacher_comment',rc.teacher_comment,'generated_at',rc.generated_at)
    ORDER BY p.start_date DESC),'[]')
  FROM public.report_cards rc JOIN public.periods p ON p.id = rc.period_id
  LEFT JOIN public.classrooms c ON c.id = rc.classroom_id WHERE rc.student_id = p_student_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_history(bigint) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 19: SEGURIDAD — triggers de auditoría y validación
-- ══════════════════════════════════════════════════════════════

-- Auditoría de pagos (trigger inmutable)
CREATE OR REPLACE FUNCTION public.fn_audit_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_payload jsonb; v_user_id uuid;
BEGIN
  BEGIN v_user_id := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user_id := NULL; END;
  IF TG_OP = 'INSERT' THEN
    v_action := 'payment.created';
    v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,'amount',NEW.amount,'month',NEW.month_paid,'status',NEW.status,'method',NEW.method,'concept',NEW.concept);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.due_date IS DISTINCT FROM NEW.due_date THEN
      v_action := CASE WHEN NEW.status='paid' AND OLD.status!='paid' THEN 'payment.approved'
                       WHEN NEW.status='overdue' AND OLD.status!='overdue' THEN 'payment.overdue'
                       WHEN NEW.status='rejected' THEN 'payment.rejected'
                       WHEN OLD.due_date IS DISTINCT FROM NEW.due_date THEN 'payment.mora_waived'
                       ELSE 'payment.updated' END;
      v_payload := jsonb_build_object('payment_id',NEW.id,'student_id',NEW.student_id,'amount',NEW.amount,'month',NEW.month_paid,'old_status',OLD.status,'new_status',NEW.status);
    ELSE RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'payment.deleted';
    v_payload := jsonb_build_object('payment_id',OLD.id,'student_id',OLD.student_id,'amount',OLD.amount,'month',OLD.month_paid,'status',OLD.status);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at) VALUES (v_user_id, v_action, v_payload, now());
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;
CREATE TRIGGER trg_audit_payment AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payment();

-- Proteger pagos aprobados
CREATE OR REPLACE FUNCTION public.fn_protect_paid_records()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin') THEN
    RAISE EXCEPTION 'No se puede modificar o eliminar un pago ya validado y aprobado.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_paid_records ON public.payments;
CREATE TRIGGER trg_protect_paid_records BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_paid_records();

-- Auto pasar a "review" al subir comprobante
CREATE OR REPLACE FUNCTION public.fn_on_payment_evidence_uploaded()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((NEW.proof_url IS NOT NULL AND NEW.proof_url <> '') AND (OLD.proof_url IS NULL OR OLD.proof_url = '')) OR
     ((NEW.evidence_url IS NOT NULL AND NEW.evidence_url <> '') AND (OLD.evidence_url IS NULL OR OLD.evidence_url = '')) THEN
    IF NEW.status IN ('pending','overdue') THEN
      NEW.status := 'review';
      NEW.notes := COALESCE(NEW.notes||' | ','')||'Comprobante subido - Pendiente de validación';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_on_evidence_uploaded ON public.payments;
CREATE TRIGGER trg_on_evidence_uploaded BEFORE UPDATE OF proof_url, evidence_url ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_payment_evidence_uploaded();

-- Auditoría de cambios de rol/perfil
CREATE OR REPLACE FUNCTION public.fn_audit_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'profile.created'; v_payload := jsonb_build_object('target_user',NEW.id,'name',NEW.name,'email',NEW.email,'role',NEW.role);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := CASE WHEN OLD.role IS DISTINCT FROM NEW.role THEN 'profile.role_changed' ELSE 'profile.updated' END;
    v_payload := jsonb_build_object('target_user',NEW.id,'old',jsonb_build_object('role',OLD.role,'name',OLD.name),'new',jsonb_build_object('role',NEW.role,'name',NEW.name));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'profile.deleted'; v_payload := jsonb_build_object('target_user',OLD.id,'name',OLD.name,'role',OLD.role);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, payload, created_at) VALUES (auth.uid(), v_action, v_payload, now()) ON CONFLICT DO NOTHING;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS audit_role_change ON public.profiles;
CREATE TRIGGER audit_role_change AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_role_change();

-- Validar cambios de rol (solo directora/admin)
CREATE OR REPLACE FUNCTION public.fn_validate_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current_role text;
BEGIN
  SELECT role INTO v_current_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF TG_OP = 'INSERT' AND v_current_role NOT IN ('directora','admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden crear perfiles';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role AND v_current_role NOT IN ('directora','admin') THEN
    RAISE EXCEPTION 'Solo directora o admin pueden modificar roles';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_role_change ON public.profiles;
CREATE TRIGGER trg_validate_role_change BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_role_change();

-- Validar avatar_url (XSS prevention)
CREATE OR REPLACE FUNCTION public.fn_validate_avatar_url()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_url IS NOT NULL THEN
    IF NEW.avatar_url ~ '["''<>\\]' THEN RAISE EXCEPTION 'avatar_url contiene caracteres no permitidos'; END IF;
    IF NOT (NEW.avatar_url ~ '^https?://' OR NEW.avatar_url ~ '^/img/') THEN
      RAISE EXCEPTION 'avatar_url inválido: solo URLs http(s) o rutas /img/';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_avatar_profiles ON public.profiles;
CREATE TRIGGER trg_validate_avatar_profiles BEFORE INSERT OR UPDATE OF avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();
DROP TRIGGER IF EXISTS trg_validate_avatar_students ON public.students;
CREATE TRIGGER trg_validate_avatar_students BEFORE INSERT OR UPDATE OF avatar_url ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_avatar_url();

-- Reports: triggers de updated_at y auditoría
DROP TRIGGER IF EXISTS set_reports_updated_at ON public.reports;
CREATE TRIGGER set_reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_report_actions_updated_at ON public.report_actions;
CREATE TRIGGER set_report_actions_updated_at BEFORE UPDATE ON public.report_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.audit_report_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.report_history (report_id, action, changed_by, old_values, new_values)
  VALUES (COALESCE(NEW.id, OLD.id),
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
    auth.uid(), CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) ELSE NULL END);
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS audit_report_changes ON public.reports;
CREATE TRIGGER audit_report_changes AFTER INSERT OR UPDATE OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_report_change();

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 20: EVENT SCHEDULE — get_classroom_schedule, log_timeline_event
-- Backfill de categorías de eventos
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_classroom_schedule(p_classroom_id bigint)
RETURNS TABLE (
  event_type text, event_label text, event_icon text, category text,
  sched_hour smallint, sched_minute smallint, duration_min smallint,
  auto_register boolean, applies_to text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT s.event_type, s.event_label, s.event_icon, s.category,
    s.scheduled_hour, s.scheduled_minute, s.duration_minutes, s.auto_register, s.applies_to
  FROM public.classroom_event_schedule s
  WHERE s.classroom_id = p_classroom_id AND s.is_active = true
  ORDER BY s.sort_order, s.scheduled_hour, s.scheduled_minute;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_classroom_schedule(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_timeline_event(
  p_classroom_id bigint, p_event_type text, p_registered_by uuid,
  p_target_students bigint[], p_scheduled_time time DEFAULT NULL,
  p_duration_minutes smallint DEFAULT NULL, p_metadata jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.timeline_event_log (classroom_id, event_type, registered_by, target_students,
    student_count, scheduled_time, actual_time, duration_minutes, metadata)
  VALUES (p_classroom_id, p_event_type, p_registered_by, p_target_students,
    array_length(p_target_students,1), p_scheduled_time, CURRENT_TIME, p_duration_minutes, p_metadata);
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_timeline_event(bigint,text,uuid,bigint[],time,smallint,jsonb) TO authenticated;

-- Backfill categorías de eventos existentes
UPDATE public.classroom_event_schedule SET category = CASE event_type
  WHEN 'desayuno' THEN 'alimentacion' WHEN 'almuerzo' THEN 'alimentacion'
  WHEN 'merienda' THEN 'alimentacion' WHEN 'biberon' THEN 'alimentacion'
  WHEN 'agua' THEN 'alimentacion' WHEN 'fruta' THEN 'alimentacion'
  WHEN 'temperatura' THEN 'salud' WHEN 'medicamento' THEN 'salud'
  WHEN 'fiebre' THEN 'salud' WHEN 'malestar' THEN 'salud'
  WHEN 'siesta' THEN 'descanso' WHEN 'descanso_corto' THEN 'descanso'
  WHEN 'panal_humedo' THEN 'higiene' WHEN 'panal_sucio' THEN 'higiene'
  WHEN 'bano' THEN 'higiene' WHEN 'cepillado' THEN 'higiene' WHEN 'lavado_manos' THEN 'higiene'
  WHEN 'actividad' THEN 'actividades' WHEN 'manualidad' THEN 'actividades'
  WHEN 'musica' THEN 'actividades' WHEN 'baile' THEN 'actividades' WHEN 'gimnasia' THEN 'actividades'
  WHEN 'patio' THEN 'juego' WHEN 'juego_libre' THEN 'juego'
  WHEN 'bienvenida' THEN 'social' WHEN 'convivencia' THEN 'social'
  WHEN 'proyecto' THEN 'aprendizaje' WHEN 'lectura' THEN 'aprendizaje'
  WHEN 'escritura' THEN 'aprendizaje' WHEN 'matematicas' THEN 'aprendizaje'
  WHEN 'paseo' THEN 'exterior' WHEN 'huerta' THEN 'exterior'
  WHEN 'accidente' THEN 'incidentes' WHEN 'golpe' THEN 'incidentes'
  WHEN 'pelea' THEN 'incidentes' WHEN 'llamada_padres' THEN 'incidentes'
  ELSE 'personalizados'
END
WHERE category = 'personalizados' OR category IS NULL;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 21: BÚSQUEDA DE ESTUDIANTES (full-text)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_students(query text)
RETURNS SETOF public.students LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.students
  WHERE search_vector @@ plainto_tsquery('simple', query)
     OR lower(name) LIKE lower('%'||query||'%')
     OR lower(COALESCE(matricula,'')) LIKE lower('%'||query||'%')
  ORDER BY ts_rank(search_vector, plainto_tsquery('simple', query)) DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.search_students(text) TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 22: STORAGE — buckets y políticas
-- ══════════════════════════════════════════════════════════════

-- Bucket: avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars','avatars',true,5242880,ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

-- Bucket: classroom_media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('classroom_media','classroom_media',true,52428800,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=52428800;

-- Bucket: karpus-uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('karpus-uploads','karpus-uploads',true,5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=true, file_size_limit=5242880;

-- Políticas storage: avatars
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='avatars' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='avatars' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='avatars' AND auth.role()='authenticated');

-- Políticas storage: classroom_media
DROP POLICY IF EXISTS "classroom_media_public_read" ON storage.objects;
CREATE POLICY "classroom_media_public_read" ON storage.objects FOR SELECT USING (bucket_id='classroom_media');
DROP POLICY IF EXISTS "classroom_media_auth_insert" ON storage.objects;
CREATE POLICY "classroom_media_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='classroom_media' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "classroom_media_auth_update" ON storage.objects;
CREATE POLICY "classroom_media_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='classroom_media' AND auth.role()='authenticated');

-- Políticas storage: karpus-uploads
DROP POLICY IF EXISTS "karpus_uploads_public_read" ON storage.objects;
CREATE POLICY "karpus_uploads_public_read" ON storage.objects FOR SELECT USING (bucket_id='karpus-uploads');
DROP POLICY IF EXISTS "karpus_uploads_auth_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id='karpus-uploads' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "karpus_uploads_auth_update" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_update" ON storage.objects FOR UPDATE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');
DROP POLICY IF EXISTS "karpus_uploads_auth_delete" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_delete" ON storage.objects FOR DELETE USING (bucket_id='karpus-uploads' AND auth.role()='authenticated');

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 23: VISTA DE FUERZA BRUTA
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_brute_force_attempts;
CREATE VIEW public.v_brute_force_attempts AS
SELECT
  email,
  COUNT(*) FILTER (WHERE success = false) AS failed_attempts,
  COUNT(*) FILTER (WHERE success = true)  AS successful_logins,
  MAX(created_at) AS last_attempt,
  CASE WHEN COUNT(*) FILTER (WHERE success=false AND created_at > NOW()-INTERVAL '1 hour') >= 5 THEN true ELSE false END AS is_suspicious
FROM public.login_attempts
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY email
ORDER BY failed_attempts DESC, last_attempt DESC;
GRANT SELECT ON public.v_brute_force_attempts TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 24: VISTA ACTIVE TASKS
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_active_tasks;
CREATE VIEW public.v_active_tasks AS
SELECT t.*, p.name AS period_name, p.status AS period_status
FROM public.tasks t
LEFT JOIN public.periods p ON p.id = t.period_id
WHERE p.is_active = true
  OR (t.period_id IS NULL AND EXISTS (
    SELECT 1 FROM public.periods ap WHERE ap.classroom_id = t.classroom_id AND ap.is_active = true
      AND t.created_at BETWEEN ap.start_date AND ap.end_date + INTERVAL '1 day'));
GRANT SELECT ON public.v_active_tasks TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 25: PERMISOS GENERALES
-- ══════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.likes               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_logs          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.door_punches        TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public              TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- SECCIÓN 26: CRON JOBS (requiere pg_cron habilitado)
-- Dashboard → Database → Extensions → pg_cron → Enable
-- Reemplaza TU_REF y SERVICE_ROLE_KEY con tus valores reales.
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('karpus-mark-overdue');            EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-payment-cycle');           EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-payment-reminders-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('karpus-cleanup-logs');            EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Marcar vencidos: cada día 6AM hora RD (10:00 UTC)
    PERFORM cron.schedule('karpus-mark-overdue','0 10 * * *',
      $c$UPDATE public.payments SET status='overdue', updated_at=now() WHERE status='pending' AND due_date < CURRENT_DATE AND deleted_at IS NULL;$c$);

    -- Ciclo de pagos: día 1 de cada mes 6AM hora RD
    PERFORM cron.schedule('karpus-payment-cycle','0 10 1 * *',
      $c$SELECT net.http_post(url:='https://TU_REF.supabase.co/functions/v1/auto-payment-cycle',headers:='{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb,body:='{"force":true}'::jsonb);$c$);

    -- Recordatorios: cada día 9AM hora RD
    PERFORM cron.schedule('karpus-payment-reminders-daily','0 13 * * *',
      $c$SELECT net.http_post(url:='https://TU_REF.supabase.co/functions/v1/payment-reminders',headers:='{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb,body:='{"action":"auto"}'::jsonb);$c$);

    -- Limpieza de logs: día 1 de cada mes 3AM UTC
    PERFORM cron.schedule('karpus-cleanup-logs','0 3 1 * *',
      $c$DELETE FROM public.login_attempts WHERE created_at < NOW()-INTERVAL '30 days'; DELETE FROM public.system_errors WHERE created_at < NOW()-INTERVAL '90 days';$c$);
  ELSE
    RAISE NOTICE 'pg_cron no instalado. Activar en Dashboard → Database → Extensions';
  END IF;
END $$;
