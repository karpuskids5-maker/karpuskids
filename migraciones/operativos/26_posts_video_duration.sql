-- ============================================================
-- 26: Muro - Duración de video
-- Agrega columna duration para mostrar la duración real del
-- video en el badge de la tarjeta (segundos, coma flotante).
-- ============================================================

-- Agregar columna de duración (segundos)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS duration real DEFAULT NULL;

-- Comentario descriptivo
COMMENT ON COLUMN posts.duration IS 'Duración del video en segundos (null para publicaciones sin video)';