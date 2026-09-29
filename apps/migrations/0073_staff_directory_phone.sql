-- 0073_staff_directory_phone.sql
--
-- Adds profiles.directory_phone: an optional phone number shown on the
-- internal Staff Directory page (/admin/directory) in place of the real
-- profiles.phone. Mirrors directory_email (0071).
--
-- Why a separate column: profiles.phone is the number customers see on
-- booking confirmations and is required everywhere (0064). A staff member may
-- want a different number for the internal staff list, and some accounts (the
-- protected owner accounts) cannot have their contact info edited from
-- Staff Management at all, so the directory needs its own editable value.
--
-- Nullable: falls back to the real profiles.phone when null or blank. Display
-- only; never used for anything customer-facing.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS directory_phone text;

COMMENT ON COLUMN profiles.directory_phone IS
  'Phone shown on the Staff Directory page (/admin/directory) in place of profiles.phone. Null or blank falls back to profiles.phone. Display only; never shown to customers.';
