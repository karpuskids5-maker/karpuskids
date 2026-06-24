-- ============================================================
-- KARPUS KIDS — FIX STORAGE POLICIES PARA AVATARES
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Arregla: "new row violates row-level security policy" al subir fotos
-- ============================================================

-- ── 1. ASEGURAR QUE EL BUCKET EXISTE Y ES PÚBLICO ────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

-- También asegurar classroom_media existe
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('classroom_media', 'classroom_media', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true;

-- También asegurar karpus-uploads existe
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('karpus-uploads', 'karpus-uploads', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ── 2. POLÍTICAS PARA BUCKET "avatars" ───────────────────────────────────────

-- Cualquier autenticado puede ver avatares (público)
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Usuario autenticado puede subir/actualizar su propio avatar
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.role() = 'authenticated'
  );

-- ── 3. POLÍTICAS PARA BUCKET "classroom_media" ───────────────────────────────

DROP POLICY IF EXISTS "classroom_media_public_read"  ON storage.objects;
CREATE POLICY "classroom_media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'classroom_media');

DROP POLICY IF EXISTS "classroom_media_auth_insert" ON storage.objects;
CREATE POLICY "classroom_media_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'classroom_media'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "classroom_media_auth_update" ON storage.objects;
CREATE POLICY "classroom_media_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'classroom_media'
    AND auth.role() = 'authenticated'
  );

-- ── 4. POLÍTICAS PARA BUCKET "karpus-uploads" ────────────────────────────────

DROP POLICY IF EXISTS "karpus_uploads_public_read"  ON storage.objects;
CREATE POLICY "karpus_uploads_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'karpus-uploads');

DROP POLICY IF EXISTS "karpus_uploads_auth_insert" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'karpus-uploads'
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "karpus_uploads_auth_update" ON storage.objects;
CREATE POLICY "karpus_uploads_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'karpus-uploads'
    AND auth.role() = 'authenticated'
  );

-- ── 5. VERIFICACIÓN ───────────────────────────────────────────────────────────
SELECT name, public FROM storage.buckets WHERE id IN ('avatars','classroom_media','karpus-uploads');
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname;
