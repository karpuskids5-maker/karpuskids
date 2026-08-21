-- ═════════════════════════════════════════════════════════════════════════════
-- FIX: Agregar columna reaction_type a la tabla likes
-- Causa: wall.js usa likes(user_id, reaction_type) y hace INSERT con
--        reaction_type, pero la columna no existe en la BD de producción.
--        Esto provoca 400 Bad Request en:
--          - GET  /rest/v1/posts?select=...likes(user_id, reaction_type)...
--          - POST /rest/v1/likes
-- Sintomas: el muro pierde reacciones/comentarios y las fotos muestran
--           "Imagen no disponible".
-- Ejecutar en Supabase SQL Editor (es idempotente, se puede repetir).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS reaction_type text DEFAULT 'like';

-- Backfill por si acaso (registros creados via rutas antiguas)
UPDATE public.likes SET reaction_type = 'like' WHERE reaction_type IS NULL;

-- Índice útil para contar reacciones por tipo
CREATE INDEX IF NOT EXISTS idx_likes_post_reaction ON public.likes(post_id, reaction_type);
