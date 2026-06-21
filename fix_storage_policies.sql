-- ============================================================
-- FIX: Storage Policies for Karpus Kids
-- ============================================================

-- First, make sure the buckets exist (if not, create them)
-- Note: You can also create buckets via Supabase Dashboard > Storage

-- ============================================================
-- 1. Bucket: karpus-uploads (for director/profile avatars)
-- ============================================================

-- Drop existing policies for karpus-uploads to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated uploads to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow public access to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes to avatars" ON storage.objects;

-- Policy: Allow authenticated users to upload to avatars folder
CREATE POLICY "Allow authenticated uploads to avatars" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'karpus-uploads' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to update avatars
CREATE POLICY "Allow authenticated updates to avatars" 
ON storage.objects 
FOR UPDATE 
TO authenticated 
USING (
  bucket_id = 'karpus-uploads' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow public access to view avatars
CREATE POLICY "Allow public access to avatars" 
ON storage.objects 
FOR SELECT 
TO public 
USING (
  bucket_id = 'karpus-uploads' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to delete avatars
CREATE POLICY "Allow authenticated deletes to avatars" 
ON storage.objects 
FOR DELETE 
TO authenticated 
USING (
  bucket_id = 'karpus-uploads' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- ============================================================
-- 2. Bucket: classroom_media (for student avatars, etc.)
-- ============================================================

-- Note: Since policy names are unique per table, so we need to name them differently for classroom_media
DROP POLICY IF EXISTS "Allow authenticated uploads to avatars-classroom" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to avatars-classroom" ON storage.objects;
DROP POLICY IF EXISTS "Allow public access to avatars-classroom" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes to avatars-classroom" ON storage.objects;

-- Policy: Allow authenticated users to upload to avatars folder
CREATE POLICY "Allow authenticated uploads to avatars-classroom" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'classroom_media' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to update avatars
CREATE POLICY "Allow authenticated updates to avatars-classroom" 
ON storage.objects 
FOR UPDATE 
TO authenticated 
USING (
  bucket_id = 'classroom_media' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow public access to view avatars
CREATE POLICY "Allow public access to avatars-classroom" 
ON storage.objects 
FOR SELECT 
TO public 
USING (
  bucket_id = 'classroom_media' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- Policy: Allow authenticated users to delete avatars
CREATE POLICY "Allow authenticated deletes to avatars-classroom" 
ON storage.objects 
FOR DELETE 
TO authenticated 
USING (
  bucket_id = 'classroom_media' AND 
  (storage.foldername(name))[1] = 'avatars'
);

-- ============================================================
-- Note: If you need more restrictive policies (e.g., only allow users to
-- upload avatars with their own user ID in the path), you can modify
-- the policies above. For example:
-- 
-- WITH CHECK (
--   bucket_id = 'karpus-uploads' AND 
--   (storage.foldername(name))[1] = 'avatars' AND
--   (storage.foldername(name))[2] = auth.uid()::text
-- );
-- ============================================================
