-- Migration 0064: Enforce phone NOT NULL on all tables that collect it
-- Phone numbers are required on all user-facing flows; this migration
-- brings the DB in line with that policy.
--
-- Existing NULL rows are set to '' (empty string) so the constraint can be
-- added without failing. Application validation rejects empty strings, so
-- the empty-string sentinel will never appear in new data.

-- profiles
UPDATE profiles SET phone = '' WHERE phone IS NULL;
ALTER TABLE profiles ALTER COLUMN phone SET NOT NULL;

-- roster_records (roster import may leave NULLs for pre-existing Enrollware rows)
UPDATE roster_records SET phone = '' WHERE phone IS NULL;
ALTER TABLE roster_records ALTER COLUMN phone SET NOT NULL;

-- team_bookings
UPDATE team_bookings SET contact_phone = '' WHERE contact_phone IS NULL;
ALTER TABLE team_bookings ALTER COLUMN contact_phone SET NOT NULL;

-- class_requests (migration 0054 added this as nullable for legacy rows)
UPDATE class_requests SET contact_phone = '' WHERE contact_phone IS NULL;
ALTER TABLE class_requests ALTER COLUMN contact_phone SET NOT NULL;

-- contact_submissions (was already enforced at the API layer but not the DB)
UPDATE contact_submissions SET phone = '' WHERE phone IS NULL;
ALTER TABLE contact_submissions ALTER COLUMN phone SET NOT NULL;
