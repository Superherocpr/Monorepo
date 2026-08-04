-- Migration 0015: Add public bio publishing flag to profiles
--
-- Controls whether a staff bio may appear on the public /about page.
-- Defaulting to false prevents existing seed, test, incomplete, or private
-- staff profiles from being published accidentally during launch.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_published boolean NOT NULL DEFAULT false;