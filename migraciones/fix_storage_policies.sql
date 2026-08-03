-- ============================================================
-- KARPUS KIDS — Políticas de Storage para uploads de avatares
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- Crear el bucket avatars si no existe (público, sin RLS estricta)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,  -- 5MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

-- Crear el bucket karpus-uploads si no existe (público)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'karpus-uploads',
  'karpus-uploads',
  true,
  5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880;

-- ── Políticas bucket: avatars ─────────────────────────────────────────────────

-- SELECT: cualquier usuario autenticado puede leer
DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- INSERT: usuarios autenticados pueden subir a su propia carpeta
DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- UPDATE: usuarios autenticados pueden actualizar
DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- DELETE: usuarios autenticados pueden borrar
DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- ── Políticas bucket: karpus-uploads ─────────────────────────────────────────

DROP POLICY IF EXISTS "karpus_uploads_select" ON storage.objects;
CREATE POLICY "karpus_uploads_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'karpus-uploads');

DROP POLICY IF EXISTS "karpus_uploads_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'karpus-uploads'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "karpus_uploads_update" ON storage.objects;
CREATE POLICY "karpus_uploads_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'karpus-uploads'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "karpus_uploads_delete" ON storage.objects;
CREATE POLICY "karpus_uploads_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'karpus-uploads'
    AND auth.role() = 'authenticated'
  );

-- ── Políticas bucket: classroom_media (si existe) ────────────────────────────

DROP POLICY IF EXISTS "classroom_media_insert" ON storage.objects;
CREATE POLICY "classroom_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'classroom_media'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "classroom_media_select" ON storage.objects;
CREATE POLICY "classroom_media_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'classroom_media');

DROP POLICY IF EXISTS "classroom_media_update" ON storage.objects;
CREATE POLICY "classroom_media_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'classroom_media'
    AND auth.role() = 'authenticated'
  );

-- Verificación
SELECT bucket_id, name, owner, created_at
FROM storage.objects
WHERE bucket_id IN ('avatars','karpus-uploads','classroom_media')
LIMIT 5;
