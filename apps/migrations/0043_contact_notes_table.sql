-- 0043: Replace the single notes text column (0042) with a proper notes log table.
-- Each note is immutable, timestamped, and attributed to the staff member who wrote it.

ALTER TABLE contact_submissions DROP COLUMN IF EXISTS notes;

CREATE TABLE IF NOT EXISTS contact_notes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid        NOT NULL REFERENCES contact_submissions(id) ON DELETE CASCADE,
  body          text        NOT NULL CHECK (char_length(trim(body)) > 0),
  created_by    uuid        NOT NULL REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_notes_submission_idx
  ON contact_notes (submission_id, created_at DESC);
