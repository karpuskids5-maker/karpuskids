-- Add missing columns to posts table that the JS code references.
-- Run this in Supabase SQL Editor if any columns already exist, it will error harmlessly.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_enabled boolean DEFAULT true;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS expire_days integer;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status text DEFAULT 'published';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tagged_students jsonb DEFAULT '[]'::jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_role text;
