-- ============================================================
-- Add authorized_pickup_phone to students table
-- ============================================================
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS authorized_pickup_phone TEXT;
