-- Migration 0033: Class assistants
--
-- BLS and ACLS classes require an in-room assistant once enrollment reaches 9
-- paid students. This migration adds:
--   1. class_types.requires_assistant_at_capacity — flags which class types
--      carry the requirement (set true for existing BLS/ACLS rows below).
--   2. class_sessions.assistant_instructor_id / assistant_name — the assigned
--      assistant, either a platform instructor (FK) or a free-text name for
--      someone outside the platform. Documentation only — no pay impact.
--   3. class_sessions.assistant_reminder_sent_at — idempotency stamp so the
--      "you need an assistant" email to the instructor fires exactly once
--      per session.

ALTER TABLE class_types
  ADD COLUMN IF NOT EXISTS requires_assistant_at_capacity boolean NOT NULL DEFAULT false;

UPDATE class_types
SET requires_assistant_at_capacity = true
WHERE name ILIKE '%BLS%' OR name ILIKE '%ACLS%';

ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS assistant_instructor_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS assistant_name text,
  ADD COLUMN IF NOT EXISTS assistant_reminder_sent_at timestamptz;
