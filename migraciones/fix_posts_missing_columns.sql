-- ═════════════════════════════════════════════════════════════════════════════
-- FIX: Agregar columnas faltantes a la tabla posts
-- Causa: Las queries del muro fallan con 400 Bad Request porque el JS
-- referencia columnas que no existen en la BD.
-- Ejecutar en Supabase SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════

-- Columnas que el JS (wall.js / wall.module.js) necesita:
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS comments_enabled boolean DEFAULT true;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS expire_days integer;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS status text DEFAULT 'published';
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS tagged_students jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS author_role text;

-- Índices para performance de las queries del scheduler y filtros
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON public.posts(status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_is_pinned ON public.posts(is_pinned) WHERE is_pinned = true;
