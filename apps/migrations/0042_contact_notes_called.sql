-- 0042: Add called flag and notes to contact_submissions
-- called: tracks whether staff has spoken to the customer by phone
-- notes:  free-form internal staff notes about the conversation
ALTER TABLE contact_submissions
  ADD COLUMN IF NOT EXISTS called  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes   text;
