-- ============================================================
-- 25: Muro - Thumbnails múltiples para vista previa de videos
-- Agrega columna thumbnail_urls para almacenar URLs de thumbnails
-- generados al subir videos (estilo YouTube hover preview).
-- ============================================================

-- Agregar columna para thumbnails múltiples
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_urls text[] DEFAULT '{}';

-- Comentario descriptivo
COMMENT ON COLUMN posts.thumbnail_urls IS 'Array de URLs de thumbnails generados al subir video (vista previa estilo YouTube)';

-- Índice GIN para buscar posts con thumbnails
CREATE INDEX IF NOT EXISTS idx_posts_thumbnail_urls ON posts USING GIN (thumbnail_urls);
