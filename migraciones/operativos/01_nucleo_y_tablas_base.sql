
-- ═════════════════════════════════════════════════════════════════════════════
-- KARPUS KIDS · ESQUEMA COMPLETO DE BASE DE DATOS (MAESTRO)
-- ═════════════════════════════════════════════════════════════════════════════
--
--   Proyecto    : Karpus Kids - Sistema de gestion escolar
--   Archivo     : karpus_schema_completo.sql
--   Version     : 1.0.0
--   Fecha       : 2026-08-14
--   Entorno     : Supabase (PostgreSQL 15+)
--   Alcance     : Consolidacion de schema.sql + 5 migraciones posteriores
--                 de produccion (las 52 historicas se integraron aqui).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INDICE
-- ─────────────────────────────────────────────────────────────────────────────
--   PARTE A · NUCLEO (schema.sql consolidado)
--     SECCION  0: Limpieza de funciones anteriores
--     SECCION  1: Extensiones
--     SECCION  2: Tipos custom
--     SECCION  3: Funcion utilitaria (get_my_role)
--     SECCION  4: Tablas core
--     SECCION  5: Datos iniciales de materias
--     SECCION  6: Indices de rendimiento
--     SECCION  7: Row Level Security (enable)
--     SECCION  8: Politicas RLS
--     SECCION  9: Funciones utilitarias
--     SECCION 10: Funcion Mora (centralizada)
--     SECCION 11: Ciclo de pagos
--     SECCION 12: Pagos (approve/delete/waive/reset/annual)
--     SECCION 13: Asistencia (process_door_punch)
--     SECCION 14: Chat
--     SECCION 14B: Funciones consolidadas de migraciones
--     SECCION 14C: Preinscripcion e inscripcion
--     SECCION 15: Periodos
--     SECCION 16: Cierre de periodo (calificaciones V2)
--     SECCION 17: Ano escolar
--     SECCION 18: Calificaciones
--     SECCION 19: Seguridad (auditoria)
--     SECCION 20: Event schedule
--     SECCION 21: Busqueda de estudiantes
--     SECCION 22: Storage
--     SECCION 23: Vista de fuerza bruta
--     SECCION 24: Vista active tasks
--     SECCION 25: Permisos generales
--     SECCION 26: Cron jobs
--
--   PARTE B · MIGRACIONES POSTERIORES INTEGRADAS
--     SECCION 27: Posts/comentarios/likes - RLS corregido
--     SECCION 28: Pagos - RLS y permisos 2026
--     SECCION 29: Reinscripcion automatica
--     SECCION 30: Tareas vinculadas a areas (config_id)
--     SECCION 31: Areas por aula + aislamiento estricto por aula
--     SECCION 32: Boletin dinamico (get_student_boletin, save_boletin_notes)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PROPIEDADES
-- ─────────────────────────────────────────────────────────────────────────────
--   * IDEMPOTENTE : puede re-ejecutarse completo sobre una base que ya lo
--                   tenga aplicado sin errores ni duplicados
--                   (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).
--   * FUENTE UNICA: reemplaza a schema.sql y a la carpeta migraciones/.
--   * INSTALACION : base nueva = ejecutar este archivo de arriba a abajo.
--   * PRODUCCION  : re-ejecutarlo sobre la base actual es seguro (no-op).
--
-- ═════════════════════════════════════════════════════════════════════════════
-- PARTE A · NUCLEO (schema.sql consolidado)
-- ═════════════════════════════════════════════════════════════════════════════
-- ============================================================
-- KARPUS KIDS — Schema Unificado v4.0
-- Consolidación de TODAS las migraciones en un solo archivo.
-- Ejecutar en Supabase SQL Editor de arriba a abajo.
-- Última actualización: Agosto 2026
-- ============================================================

-- Desactiva la validación del cuerpo de funciones LANGUAGE sql en el CREATE.
-- Necesario en bases nuevas: get_my_role() (SECCIÓN 3) referencia
-- public.profiles, que se crea en la SECCIÓN 4.
SET check_function_bodies = off;

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
        'financial_summary_month','close_period',
        'user_is_participant',
        'get_current_period','get_tasks_for_period','get_posts_for_period',
        'activate_period','get_student_history','is_period_open','get_active_period',
        'is_teacher_of_classroom','is_parent_of_student',
        'is_parent_of_classroom','is_teacher_of_student','get_my_classroom_ids',
        'run_payment_cycle','get_unread_counts','get_dashboard_kpis',
        'attendance_last_7_days',
        'find_or_create_private_conversation','get_direct_messages',
        'send_notification','get_my_role','handle_new_user',
        'handle_new_post_teacher_info','update_post_comments_count',
        'update_post_likes_count','handle_student_chat_creation',
        'notify_parent_on_new_charge',
        'assign_student_to_classroom','assign_students_bulk','set_updated_at',
        'calc_mora','calculate_mora_v2',
        'preview_payment_cycle','check_payment_cycle_health',
        'process_door_punch','process_student_punch','approve_payment',
        'delete_payment','waive_payment_mora','reset_payment_to_pending',
        'is_email_under_attack','mark_messages_read','search_students',
        'update_staff_permits_timestamp','fn_audit_payment','fn_audit_role_change',
        'fn_validate_role_change','fn_protect_paid_records',
        'fn_on_payment_evidence_uploaded',
        'mark_overdue_payments','generate_annual_payments','pay_full_year',
        'get_active_school_year','get_school_year_status','close_school_year',
        'promote_students','can_enroll_student',
        'advance_school_year_state','get_period_stats',
        'get_periods_for_year','create_school_year','update_school_year',
        'create_academic_period','delete_academic_periods_by_year',
        'get_first_academic_period','activate_academic_period',
        'get_legacy_periods_for_sync','get_period_config',
        'get_activities_with_grades','get_student_grades_v2',
        'get_student_subject_averages','get_classroom_schedule',
        'log_timeline_event','audit_report_change','fn_validate_avatar_url',
        'check_payment_cycle_health'
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
  score_v2     numeric(5,2) CHECK (score_v2 >= 0 AND score_v2 <= 100),
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(task_id, student_id)
);

ALTER TABLE public.task_evidences ADD COLUMN IF NOT EXISTS score_v2 numeric(5,2) CHECK (score_v2 >= 0 AND score_v2 <= 100);

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
  is_pinned       boolean DEFAULT false,
  comments_enabled boolean DEFAULT true,
  expire_days     integer,
  scheduled_at    timestamptz,
  status          text DEFAULT 'published',
  views_count     integer DEFAULT 0,
  tagged_students jsonb DEFAULT '[]'::jsonb,
  thumbnail_url   text,
  author_role     text,
  updated_at      timestamp with time zone DEFAULT now(),
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

-- Idempotente: agrega columnas que pudieran faltar si la tabla ya existía
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS comments_enabled boolean DEFAULT true;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS expire_days integer;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS status text DEFAULT 'published';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tagged_students jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS author_role text;

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

