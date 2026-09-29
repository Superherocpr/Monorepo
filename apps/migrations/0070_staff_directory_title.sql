-- 0070_staff_directory_title.sql
--
-- Adds profiles.directory_title: a short internal-only line ("Lead Instructor
-- — Bradenton", "Billing & Scheduling") shown on the new internal Staff
-- Directory page (/admin/directory, all staff roles). Distinct from
-- bio_description, which is public marketing copy for the /about page and
-- the wrong tone/audience for an internal contact list.
--
-- Nullable: existing staff have no value until a super admin sets one from
-- the Staff Management edit panel; the directory page simply omits the line
-- when null.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS directory_title text;

COMMENT ON COLUMN profiles.directory_title IS
  'Short internal role/blurb shown on the Staff Directory page (/admin/directory). Null hides the line. Not shown publicly — see bio_description for the public About page bio.';
