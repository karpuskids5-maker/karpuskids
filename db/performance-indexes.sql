-- ============================================================
-- 🚀 Karpus Kids — Performance Indexes
-- Ejecutar en Supabase SQL Editor para soportar 10k+ usuarios
-- ============================================================

-- ── payments ─────────────────────────────────────────────────
-- Filtro más común: por mes y estado
CREATE INDEX IF NOT EXISTS idx_payments_month_status
  ON payments (month_paid, status);

-- Filtro por estudiante + mes
CREATE INDEX IF NOT EXISTS idx_payments_student_month
  ON payments (student_id, month_paid);

-- Filtro por fecha de vencimiento (recordatorios)
CREATE INDEX IF NOT EXISTS idx_payments_due_date_status
  ON payments (due_date, status)
  WHERE status IN ('pending', 'pendiente');

-- ── students ─────────────────────────────────────────────────
-- Búsqueda por nombre (ILIKE)
CREATE INDEX IF NOT EXISTS idx_students_name_trgm
  ON students USING gin (name gin_trgm_ops);

-- Filtro por aula
CREATE INDEX IF NOT EXISTS idx_students_classroom
  ON students (classroom_id) WHERE is_active = true;

-- Filtro por padre
CREATE INDEX IF NOT EXISTS idx_students_parent
  ON students (parent_id);

-- ── attendance ───────────────────────────────────────────────
-- Query más común: por fecha + aula
CREATE INDEX IF NOT EXISTS idx_attendance_date_classroom
  ON attendance (date, classroom_id);

-- Por estudiante + fecha
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
  ON attendance (student_id, date);

-- ── messages ─────────────────────────────────────────────────
-- Por conversación (paginación de mensajes)
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at DESC);

-- Mensajes no leídos por receptor
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
  ON messages (receiver_id, is_read)
  WHERE is_read = false;

-- ── notifications ────────────────────────────────────────────
-- No leídas por usuario
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, is_read, created_at DESC)
  WHERE is_read = false;

-- ── posts (muro) ─────────────────────────────────────────────
-- Por aula + fecha (feed del muro)
CREATE INDEX IF NOT EXISTS idx_posts_classroom_created
  ON posts (classroom_id, created_at DESC);

-- ── task_evidences ───────────────────────────────────────────
-- Por tarea (calificaciones)
CREATE INDEX IF NOT EXISTS idx_task_evidences_task
  ON task_evidences (task_id, created_at DESC);

-- Por estudiante
CREATE INDEX IF NOT EXISTS idx_task_evidences_student
  ON task_evidences (student_id);

-- ── profiles ─────────────────────────────────────────────────
-- Búsqueda por nombre (chat)
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm
  ON profiles USING gin (name gin_trgm_ops);

-- Filtro por rol
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles (role);

-- ── conversation_participants ────────────────────────────────
-- Buscar conversaciones de un usuario
CREATE INDEX IF NOT EXISTS idx_conv_participants_user
  ON conversation_participants (user_id);

-- ── Habilitar extensión pg_trgm si no está activa ────────────
-- (necesaria para los índices gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Estadísticas actualizadas ────────────────────────────────
-- Ejecutar después de crear los índices
ANALYZE payments;
ANALYZE students;
ANALYZE attendance;
ANALYZE messages;
ANALYZE notifications;
ANALYZE posts;
