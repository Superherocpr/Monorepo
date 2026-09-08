-- 0069_class_request_venue_mode.sql
--
-- Lets a customer request a class at one of our own locations instead of
-- naming their own venue — with no $65 travel & setup fee, since no travel is
-- required to reach a location we already teach from.
--
-- Background. locations.is_home_base previously meant "the one home base";
-- app code enforced exactly one at a time. Many instructors teach out of their
-- own address, so that has been widened to "any number of home bases" (app
-- code only — no schema change was needed there). This migration is the other
-- half: letting a class_requests row point at one of those locations instead
-- of carrying a freeform address.
--
-- Two request shapes now exist, told apart by venue_mode:
--   'customer_venue' — the existing behaviour. venue_name/address/zip are
--                       filled in by hand; on approval a NEW locations row is
--                       created from them.
--   'home_base'       — venue_location_id points at an existing, active
--                       home-base location; venue_name/address/zip are left
--                       null (we already have the address on file and it is
--                       not shown to the customer, only the city). On
--                       approval the EXISTING location is reused rather than
--                       creating a duplicate, and travel_fee is written as 0
--                       at submission time by the API route.
--
-- venue_city/venue_state stay NOT NULL in both shapes: for home_base they are
-- copied from the chosen location at submission time, so every other query
-- and email template that already reads venue_city/venue_state keeps working
-- unchanged regardless of which shape the row is.

-- ---------------------------------------------------------------------------
-- 1. venue_mode
-- ---------------------------------------------------------------------------

ALTER TABLE class_requests
  ADD COLUMN IF NOT EXISTS venue_mode text NOT NULL DEFAULT 'customer_venue';

ALTER TABLE class_requests
  DROP CONSTRAINT IF EXISTS class_requests_venue_mode_check;

ALTER TABLE class_requests
  ADD CONSTRAINT class_requests_venue_mode_check
  CHECK (venue_mode IN ('customer_venue', 'home_base'));

COMMENT ON COLUMN class_requests.venue_mode IS
  'customer_venue: freeform address, entered by hand. home_base: an existing locations row, picked from a dropdown of is_home_base locations. Default backfills every pre-existing row correctly, since they all carry a real venue_name/address/zip.';

-- ---------------------------------------------------------------------------
-- 2. venue_location_id
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL rather than RESTRICT: deleting a location must not be
-- blocked by an old class_requests row referencing it. The approve route
-- checks for a null venue_location_id on a home_base row and fails with a
-- clear error rather than silently mis-handling it.

ALTER TABLE class_requests
  ADD COLUMN IF NOT EXISTS venue_location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN class_requests.venue_location_id IS
  'Set only when venue_mode = home_base. The existing location this request re-uses on approval, instead of creating a new one.';

-- ---------------------------------------------------------------------------
-- 3. venue_name / venue_address / venue_zip become optional
-- ---------------------------------------------------------------------------
-- A home_base request has this information on the locations row already —
-- storing it a second time on class_requests would let the two disagree if
-- the location is later edited. venue_city/venue_state are the exception:
-- they stay NOT NULL because so much existing code (admin list/detail views,
-- both request-stage and approval-stage emails) reads them unconditionally.

ALTER TABLE class_requests
  ALTER COLUMN venue_name DROP NOT NULL,
  ALTER COLUMN venue_address DROP NOT NULL,
  ALTER COLUMN venue_zip DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Shape invariant
-- ---------------------------------------------------------------------------
-- Every existing row is customer_venue with all three fields populated, so
-- this holds immediately with no backfill.

ALTER TABLE class_requests
  DROP CONSTRAINT IF EXISTS class_requests_venue_shape_check;

ALTER TABLE class_requests
  ADD CONSTRAINT class_requests_venue_shape_check
  CHECK (
    (venue_mode = 'customer_venue'
      AND venue_name IS NOT NULL
      AND venue_address IS NOT NULL
      AND venue_zip IS NOT NULL)
    OR
    (venue_mode = 'home_base'
      AND venue_name IS NULL
      AND venue_address IS NULL
      AND venue_zip IS NULL)
  );
