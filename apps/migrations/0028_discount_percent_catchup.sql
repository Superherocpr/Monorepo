-- Migration 0028: discount_percent catch-up
--
-- class_sessions.discount_percent was applied to staging by hand on 2026-07-03
-- (tracked in Supabase's migration history as "add_discount_percent_to_class_sessions")
-- but never written back to this repo, so it was missing from production and from
-- the migration file history here. This closes that gap for anywhere it's still missing.

ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS discount_percent numeric;

ALTER TABLE class_sessions
  DROP CONSTRAINT IF EXISTS class_sessions_discount_percent_check;

ALTER TABLE class_sessions
  ADD CONSTRAINT class_sessions_discount_percent_check
  CHECK (discount_percent >= 0 AND discount_percent <= 50);
