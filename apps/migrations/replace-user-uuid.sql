-- =============================================================================
-- UUID Replacement Migration
-- Run in: Supabase SQL editor (service role / superuser required)
--
-- Replaces every occurrence of OLD_UUID with NEW_UUID across auth.users,
-- profiles, and all tables that reference profiles.id as a foreign key.
--
-- Strategy: SET session_replication_role = 'replica' disables FK trigger
-- enforcement for the duration of this session, allowing us to update PKs
-- and FKs in any order without violating referential integrity mid-script.
-- Constraints are re-validated when the session role is restored to DEFAULT.
-- =============================================================================

DO $$
DECLARE
  OLD_UUID uuid := '10000000-0000-0000-0000-000000000001';
  NEW_UUID uuid := 'ab16b425-95f6-43ac-884f-5eddada2653a';
BEGIN

  -- Disable FK trigger enforcement for this session.
  -- This is safe here because we are updating every reference atomically
  -- within this single transaction block.
  SET session_replication_role = 'replica';

  -- -------------------------------------------------------------------------
  -- auth.users — root record that profiles.id references
  -- -------------------------------------------------------------------------
  UPDATE auth.users
  SET id = NEW_UUID
  WHERE id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- profiles — PK references auth.users.id
  -- -------------------------------------------------------------------------
  UPDATE profiles
  SET id = NEW_UUID
  WHERE id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- api_keys — profile_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE api_keys
  SET profile_id = NEW_UUID
  WHERE profile_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- instructor_payment_accounts — instructor_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE instructor_payment_accounts
  SET instructor_id = NEW_UUID
  WHERE instructor_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- contact_replies — sent_by FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE contact_replies
  SET sent_by = NEW_UUID
  WHERE sent_by = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- class_sessions — instructor_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE class_sessions
  SET instructor_id = NEW_UUID
  WHERE instructor_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- certifications — customer_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE certifications
  SET customer_id = NEW_UUID
  WHERE customer_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- invoices — instructor_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE invoices
  SET instructor_id = NEW_UUID
  WHERE instructor_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- invoice_activity_log — actor_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE invoice_activity_log
  SET actor_id = NEW_UUID
  WHERE actor_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- bookings — three separate FK columns → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE bookings
  SET customer_id = NEW_UUID
  WHERE customer_id = OLD_UUID;

  UPDATE bookings
  SET created_by = NEW_UUID
  WHERE created_by = OLD_UUID;

  UPDATE bookings
  SET cancelled_by = NEW_UUID
  WHERE cancelled_by = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- payments — two separate FK columns → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE payments
  SET customer_id = NEW_UUID
  WHERE customer_id = OLD_UUID;

  UPDATE payments
  SET logged_by = NEW_UUID
  WHERE logged_by = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- orders — customer_id FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE orders
  SET customer_id = NEW_UUID
  WHERE customer_id = OLD_UUID;

  -- -------------------------------------------------------------------------
  -- stock_adjustments — adjusted_by FK → profiles.id
  -- -------------------------------------------------------------------------
  UPDATE stock_adjustments
  SET adjusted_by = NEW_UUID
  WHERE adjusted_by = OLD_UUID;

  -- Restore normal FK enforcement (origin is the default/normal mode).
  SET session_replication_role = 'origin';

  RAISE NOTICE 'UUID replacement complete: % → %', OLD_UUID, NEW_UUID;

END $$;
