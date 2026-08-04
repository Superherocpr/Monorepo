-- Migration 0010: Add bio stat columns to profiles
-- Stores the "years experience" and "students trained" figures shown on the
-- lead instructor's section of the /about page. Both are stored as plain text
-- so the admin can control the displayed value precisely (e.g. "20", "5,000+").
-- Managed via the admin staff panel BioEditPanel component.
-- NULL means the stat is not shown on the /about page.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_years_experience TEXT NULL,
  ADD COLUMN IF NOT EXISTS bio_students_trained TEXT NULL;
