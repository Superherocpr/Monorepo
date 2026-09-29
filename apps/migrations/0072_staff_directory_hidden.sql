-- 0072_staff_directory_hidden.sql
--
-- Adds profiles.hide_from_directory: lets a super admin keep a staff account
-- (typically a test account) off the internal Staff Directory page
-- (/admin/directory) without deactivating it, since deactivation also blocks
-- sign-in and test accounts still need to log in.
--
-- Defaults to false, so every existing account keeps appearing exactly as
-- before. The flag only affects the directory page; the account still shows
-- on Staff Management and everywhere else.
--
-- No backfill: which account is the test account differs per environment,
-- so it is set from the Edit Info panel on /admin/staff rather than by email.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hide_from_directory boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.hide_from_directory IS
  'When true, this account is omitted from the Staff Directory page (/admin/directory). Does not affect login or any other screen.';
