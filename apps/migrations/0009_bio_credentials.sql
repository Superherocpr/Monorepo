-- Migration 0009: Add bio_credentials column to profiles
-- Stores a comma-separated list of credentials for instructors who appear
-- on the /about page (e.g. "Licensed AHA Instructor, BLS Provider").
-- Managed via the admin staff panel BioEditPanel component.
-- NULL means no credentials have been entered yet (renders nothing on /about).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_credentials TEXT NULL;
