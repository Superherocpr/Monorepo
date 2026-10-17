-- 0079_whats_new_seen.sql
--
-- Adds profiles.whats_new_seen_version: the newest app version whose
-- "What's New" entries this staff member has already looked at. The admin
-- sidebar shows an unread count for entries newer than this value, and opening
-- /admin/whats-new advances it (POST /api/profile/whats-new-seen).
--
-- Why a column and not browser storage: the unread state has to follow the
-- person across devices, so a new phone does not flag the whole history as new.
--
-- Nullable on purpose. Null means "never opened What's New": the app then
-- treats only entries released after the account was created as unread, so a
-- new hire does not start with the entire history flagged.
--
-- Backfill: every existing account is set to 1.7.0 (the release before this
-- feature) so the first thing existing staff see as unread is the What's New
-- announcement itself, not the backfilled history. Customer profiles get the
-- value too, harmlessly; the column is only ever read for staff.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whats_new_seen_version text;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_whats_new_seen_version_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_whats_new_seen_version_check
  CHECK (whats_new_seen_version IS NULL OR whats_new_seen_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

COMMENT ON COLUMN profiles.whats_new_seen_version IS
  'Newest app version (major.minor.patch) whose What''s New entries this staff member has seen. Null = never opened; only entries released after created_at count as unread. Advanced by POST /api/profile/whats-new-seen.';

UPDATE profiles
SET whats_new_seen_version = '1.7.0'
WHERE whats_new_seen_version IS NULL;
