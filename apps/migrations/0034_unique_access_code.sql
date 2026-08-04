-- Migration 0034: Unique rollcall access codes
--
-- daily_access_code had no uniqueness guarantee. If two instructors ever
-- collided on the same 6-digit code, verify-code's .maybeSingle() would see
-- two rows and error — breaking rollcall for BOTH instructors at once, with
-- only a generic "code doesn't match" shown to students.
--
-- Partial unique index (NULLs excluded) — most profiles are customers with
-- no code, and multiple NULLs must remain allowed.

CREATE UNIQUE INDEX IF NOT EXISTS profiles_daily_access_code_unique
  ON profiles (daily_access_code)
  WHERE daily_access_code IS NOT NULL;
