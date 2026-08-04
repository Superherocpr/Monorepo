-- Migration: 0025_customer_class_requests
-- Adds the customer-requested class feature:
--   1. New `class_requests` table for customer submissions
--   2. `travel_fee` and `class_request_id` columns on `class_sessions`
--   3. Makes `instructor_id` nullable so customer-requested sessions
--      can exist without an instructor until one accepts

-- ── 1. class_requests table ───────────────────────────────────────────────────
CREATE TABLE class_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES profiles(id),
  class_type_id         uuid NOT NULL REFERENCES class_types(id),
  preferred_date        date NOT NULL,
  preferred_time_of_day text NOT NULL
                          CHECK (preferred_time_of_day IN ('morning','afternoon','evening','flexible')),
  group_size            int NOT NULL CHECK (group_size >= 1),
  venue_name            text NOT NULL,
  venue_address         text NOT NULL,
  venue_city            text NOT NULL,
  venue_state           text NOT NULL,
  venue_zip             text NOT NULL,
  notes                 text,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','instructor_assigned')),
  rejection_reason      text,
  travel_fee            numeric NOT NULL DEFAULT 65,
  session_id            uuid REFERENCES class_sessions(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Add columns to class_sessions ─────────────────────────────────────────
ALTER TABLE class_sessions
  ADD COLUMN travel_fee        numeric,
  ADD COLUMN class_request_id  uuid REFERENCES class_requests(id);

-- ── 3. Allow NULL instructor_id on class_sessions ─────────────────────────────
-- Customer-requested sessions have no instructor until one accepts first-come-first-serve.
ALTER TABLE class_sessions
  ALTER COLUMN instructor_id DROP NOT NULL;
