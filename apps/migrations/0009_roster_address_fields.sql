-- Migration 0009: Add address fields to roster_records
-- Students imported into Enrollware require address data (address_1, address_2,
-- city, state, zip). This data was missing from roster_records and must be
-- captured at roster import time and surfaced in the Enrollware bookmarklet export.
-- All fields are nullable so existing rows are unaffected.

ALTER TABLE roster_records
  ADD COLUMN IF NOT EXISTS address_1 text,
  ADD COLUMN IF NOT EXISTS address_2 text,
  ADD COLUMN IF NOT EXISTS city      text,
  ADD COLUMN IF NOT EXISTS state     text,
  ADD COLUMN IF NOT EXISTS zip       text;
