-- 0062_student_documents.sql
--
-- Per-student document/photo storage for the admin session detail page
-- (/admin/sessions/[id]). First piece of the planned Enrollware "Documents"
-- upload feature — this table is where photos live once uploaded; the
-- bookmarklet-side injection into Enrollware's own Documents panel (confirmed
-- feasible via live-site testing, capped at 20 files per batch by Enrollware's
-- own upload widget) is a separate, not-yet-built piece that will read from here.
--
-- A "student" in this table is either a bookings row (has a SuperheroCPR
-- account) or a roster_records row (rollcall/walk-in, no account) — the same
-- dual representation the session detail page already renders as one table.
-- Exactly one of booking_id / roster_record_id is set, matching the row the
-- document was uploaded from.

CREATE TABLE IF NOT EXISTS student_documents (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- Denormalized against booking_id/roster_record_id so per-session queries and
  -- cleanup don't need to join through two different parent tables.
  session_id        uuid        NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  booking_id        uuid        REFERENCES bookings(id) ON DELETE CASCADE,
  roster_record_id  uuid        REFERENCES roster_records(id) ON DELETE CASCADE,
  file_url          text        NOT NULL,
  file_name         text        NOT NULL,
  content_type      text        NOT NULL,
  size_bytes        integer     NOT NULL,
  uploaded_by       uuid        NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT student_documents_owner_check CHECK (
    (booking_id IS NOT NULL AND roster_record_id IS NULL) OR
    (booking_id IS NULL AND roster_record_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS student_documents_session_idx
  ON student_documents (session_id);
CREATE INDEX IF NOT EXISTS student_documents_booking_idx
  ON student_documents (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS student_documents_roster_idx
  ON student_documents (roster_record_id) WHERE roster_record_id IS NOT NULL;

-- No RLS policies: accessed exclusively through server actions using the
-- service-role client (app/(admin)/admin/sessions/[id]/actions.ts), same as
-- contact_notes (migration 0043). Role + session-ownership checks happen there.
ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
