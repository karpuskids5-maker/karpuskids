-- ============================================================
-- KARPUS KIDS — Índices de Rendimiento
-- Ejecutar en Supabase SQL Editor para mejorar velocidad de búsquedas.
-- Estos índices reducen el tiempo de consulta de O(n) a O(log n).
-- ============================================================

-- 1. ÍNDICES BÁSICOS EN COLUMNAS CRÍTICAS
-- ─────────────────────────────────────────────────────────────

-- Búsqueda de estudiantes por nombre (reemplaza ILIKE lento)
CREATE INDEX IF NOT EXISTS idx_students_name_lower
  ON public.students (lower(name));

-- Búsqueda por matrícula
CREATE INDEX IF NOT EXISTS idx_students_matricula
  ON public.students (matricula)
  WHERE matricula IS NOT NULL;

-- Filtro de pagos por mes (usado en loadPayments)
CREATE INDEX IF NOT EXISTS idx_payments_month_paid
  ON public.payments (month_paid);

-- Filtro de pagos por estudiante + mes (constraint única + búsqueda)
CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON public.payments (student_id, month_paid);

-- Filtro de pagos por estado
CREATE INDEX IF NOT EXISTS idx_payments_status
  ON public.payments (status);

-- Búsqueda de perfiles por nombre
CREATE INDEX IF NOT EXISTS idx_profiles_name_lower
  ON public.profiles (lower(name));

-- Búsqueda de perfiles por rol (usado en chat contacts)
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);

-- Notificaciones no leídas por usuario (usado en badges)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read)
  WHERE is_read = false;

-- Mensajes por conversación (usado en chat)
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages (conversation_id, created_at DESC);

-- Asistencia por aula y fecha (usado en attendance module)
CREATE INDEX IF NOT EXISTS idx_attendance_classroom_date
  ON public.attendance (classroom_id, date);

-- Posts por fecha (usado en wall)
CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON public.posts (created_at DESC);

-- Posts por aula (usado en wall filter)
CREATE INDEX IF NOT EXISTS idx_posts_classroom_id
  ON public.posts (classroom_id)
  WHERE classroom_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. FULL-TEXT SEARCH — Búsqueda rápida por nombre
-- ─────────────────────────────────────────────────────────────

-- Columna tsvector para búsqueda full-text en estudiantes
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish',
      coalesce(name, '') || ' ' ||
      coalesce(matricula, '') || ' ' ||
      coalesce(p1_name, '') || ' ' ||
      coalesce(p1_phone, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_students_search_vector
  ON public.students USING GIN (search_vector);

-- Columna tsvector para búsqueda full-text en perfiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish',
      coalesce(name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(phone, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_search_vector
  ON public.profiles USING GIN (search_vector);

-- ─────────────────────────────────────────────────────────────
-- 3. ÍNDICES GIN PARA CAMPOS JSONB
-- ─────────────────────────────────────────────────────────────

-- Índice GIN en audit_logs.payload (búsquedas dentro del JSON)
CREATE INDEX IF NOT EXISTS idx_audit_logs_payload
  ON public.audit_logs USING GIN (payload jsonb_path_ops)
  WHERE payload IS NOT NULL;

-- Índice GIN en system_events.payload si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_events'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_system_events_payload
      ON public.system_events USING GIN (payload jsonb_path_ops)
      WHERE payload IS NOT NULL';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. FUNCIÓN DE BÚSQUEDA FULL-TEXT (opcional, para uso futuro)
-- ─────────────────────────────────────────────────────────────

-- Función para buscar estudiantes con full-text search
CREATE OR REPLACE FUNCTION search_students(query text)
RETURNS SETOF public.students
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.students
  WHERE search_vector @@ plainto_tsquery('spanish', query)
     OR lower(name) LIKE lower('%' || query || '%')
     OR lower(matricula) LIKE lower('%' || query || '%')
  ORDER BY ts_rank(search_vector, plainto_tsquery('spanish', query)) DESC
  LIMIT 50;
$$;

-- ─────────────────────────────────────────────────────────────
-- VERIFICACIÓN: Listar índices creados
-- ─────────────────────────────────────────────────────────────
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;
