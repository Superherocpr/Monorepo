-- Per-session additional hours on top of the class type's default duration.
-- Default 0 — no extra time. Used for Enrollware reporting when a class runs longer than usual.
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS additional_hours integer NOT NULL DEFAULT 0;
