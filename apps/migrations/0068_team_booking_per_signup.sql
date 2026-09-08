-- 0068_team_booking_per_signup.sql
--
-- Adds a third team-booking payment mode and tracks the contact share-link email.
--
-- Background. A team booking (migration 0055) supported two ways of paying:
--   'company'  — a flat total, invoiced to the company up front at booking time.
--   'per_seat' — each employee pays the staff-quoted price at their own signup.
--
-- Neither fits the common corporate arrangement of "bill us for however many of
-- our people actually sign up." Quoting a flat total means guessing the headcount
-- on the phone and eating the difference; per_seat bills the employees, not the
-- company. This migration adds:
--
--   'company_per_signup' — the company is billed price_per_seat x the number of
--                          people who signed up through the link. Employees sign
--                          up free, exactly as in 'company' mode. The invoice is
--                          raised AFTER the class (by the nightly sweep in
--                          migration 0067) or on demand from the admin UI, since
--                          the amount is not knowable until signups are in.
--
-- Design note — why the price shape differs for the new mode. In 'company' mode
-- total_price is authoritative and set at insert. In 'company_per_signup' it is
-- DERIVED: null until an invoice is raised, then written as the amount actually
-- billed so the invoices page, the admin UI and any later audit all agree on the
-- figure that went to PayPal. The constraint below therefore requires
-- price_per_seat (the rate) but leaves total_price free.

-- ---------------------------------------------------------------------------
-- 1. Widen the payment-mode and price-shape constraints
-- ---------------------------------------------------------------------------

ALTER TABLE team_bookings
  DROP CONSTRAINT IF EXISTS team_bookings_payment_mode_check;

ALTER TABLE team_bookings
  ADD CONSTRAINT team_bookings_payment_mode_check
  CHECK (payment_mode IN ('company', 'per_seat', 'company_per_signup'));

ALTER TABLE team_bookings
  DROP CONSTRAINT IF EXISTS team_bookings_price_shape_check;

ALTER TABLE team_bookings
  ADD CONSTRAINT team_bookings_price_shape_check CHECK (
    -- Employee pays: a per-seat price, never a company total.
    (payment_mode = 'per_seat' AND price_per_seat IS NOT NULL AND total_price IS NULL)
    OR
    -- Company pays a flat amount agreed up front.
    (payment_mode = 'company' AND total_price IS NOT NULL AND price_per_seat IS NULL)
    OR
    -- Company pays per signup: the rate is fixed, the total is computed at
    -- invoice time and written back, so total_price is null until then.
    (payment_mode = 'company_per_signup' AND price_per_seat IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. contact_link_sent_at
-- ---------------------------------------------------------------------------
-- The signup link is now emailed to the company contact automatically rather
-- than being copied out of the admin UI by hand. An instructor-created booking
-- is not approved yet at creation time, and an unapproved link refuses signups,
-- so for those the mail is held and sent when a manager approves the class.
--
-- This column is what makes that send exactly-once. Resend's idempotency key
-- only dedupes a short window, which is not enough: approving, editing (which
-- resets approval_status to 'pending_approval') and re-approving days later
-- would otherwise mail the contact the same link a second time.
ALTER TABLE team_bookings
  ADD COLUMN IF NOT EXISTS contact_link_sent_at timestamptz;

COMMENT ON COLUMN team_bookings.contact_link_sent_at IS
  'When the signup link was emailed to the company contact. Null means not yet sent (class still awaiting approval, or created before this feature). Set once, never cleared.';

-- ---------------------------------------------------------------------------
-- 3. Index for the per-signup sweep
-- ---------------------------------------------------------------------------
-- Migration 0067 indexed uninvoiced 'company' bookings. The nightly sweep now
-- also finalises 'company_per_signup' bookings whose class has ended, so the
-- partial index is widened to cover both company-paid modes.
DROP INDEX IF EXISTS idx_team_bookings_uninvoiced;

CREATE INDEX IF NOT EXISTS idx_team_bookings_uninvoiced
  ON team_bookings (created_at DESC)
  WHERE payment_mode IN ('company', 'company_per_signup') AND invoice_id IS NULL;
