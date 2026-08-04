-- 0032_profiles_archived_at
-- Adds archived_at timestamptz to profiles so the archived accounts page can
-- display and sort by when an account was archived. Backfills existing archived
-- rows with their updated_at value as the best available approximation.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

-- Backfill: any already-archived row gets updated_at as the archive timestamp
UPDATE profiles
SET archived_at = updated_at
WHERE archived = true AND archived_at IS NULL;
