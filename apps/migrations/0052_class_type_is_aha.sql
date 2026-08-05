-- =============================================================================
-- Migration 0052: Add is_aha flag to class_types
--
-- What this does:
--   1. Adds is_aha boolean column (NOT NULL, default false).
--   2. Backfills is_aha = true for every class type that already has a
--      cert_type_id — all current cert-linked types are AHA courses.
--   3. Future class types get is_aha derived from the cert type dropdown in
--      the admin panel (selecting a cert auto-enables the flag).
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS; UPDATE is idempotent.
-- =============================================================================

ALTER TABLE class_types
  ADD COLUMN IF NOT EXISTS is_aha boolean NOT NULL DEFAULT false;

-- Backfill: every existing class type that issues a cert is an AHA course.
UPDATE class_types
   SET is_aha = true
 WHERE cert_type_id IS NOT NULL;
