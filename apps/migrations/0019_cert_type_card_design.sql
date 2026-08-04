-- Migration 0019: Add card_design column to cert_types
--
-- Allows each cert type to specify which card template is shown to the student.
-- Supported values: 'aha' (default) | 'superherocpr'
-- Set to NOT NULL with a default so all existing AHA cert types automatically
-- use the AHA card without any backfill required.

ALTER TABLE cert_types
  ADD COLUMN IF NOT EXISTS card_design TEXT NOT NULL DEFAULT 'aha';

-- Add a check constraint so only known design names can be stored.
-- This prevents typos from silently causing fallback rendering.
-- Drop first in case a previous partial run already created it.
ALTER TABLE cert_types
  DROP CONSTRAINT IF EXISTS cert_types_card_design_check;

ALTER TABLE cert_types
  ADD CONSTRAINT cert_types_card_design_check
    CHECK (card_design IN ('aha', 'superherocpr'));
