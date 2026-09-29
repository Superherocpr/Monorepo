-- 0071_staff_directory_email.sql
--
-- Adds profiles.directory_email: an optional public-facing contact email
-- shown on the internal Staff Directory page (/admin/directory) in place of
-- the real profiles.email. profiles.email is also the login address (see
-- migration 0065 and the Settings Account tab), so it can't be overwritten
-- just to hide it from the directory without breaking sign-in. This column
-- lets a real address stay private while a shared/monitored inbox is shown
-- to other staff instead.
--
-- Nullable: falls back to the real profiles.email when null, which is the
-- unchanged behavior for everyone who doesn't need an override.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS directory_email text;

COMMENT ON COLUMN profiles.directory_email IS
  'Public-facing contact email shown on the Staff Directory page (/admin/directory) in place of the real profiles.email. Null falls back to profiles.email. Never used for login or notifications, only for this display.';

-- ---------------------------------------------------------------------------
-- Backfill: hide Daniel Hedgeman's personal email from the directory
-- ---------------------------------------------------------------------------
-- Requested directly by the account owner for privacy: his real login email
-- (dannydavon@gmail.com) stays as-is for sign-in, but the Staff Directory
-- shows the shared superherocpr@gmail.com inbox instead. Idempotent: safe to
-- run again, and a no-op if the row doesn't exist in a given environment.

UPDATE profiles
SET directory_email = 'superherocpr@gmail.com'
WHERE email = 'dannydavon@gmail.com';
