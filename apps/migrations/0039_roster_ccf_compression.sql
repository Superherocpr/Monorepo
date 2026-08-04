-- Add CCF (Chest Compression Fraction) score to roster_records.
-- Nullable — only populated for class types that require CPR feedback metrics.
ALTER TABLE roster_records ADD COLUMN IF NOT EXISTS ccf_compression integer;
