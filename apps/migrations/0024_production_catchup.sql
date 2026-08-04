-- =============================================================================
-- Migration 0024: Production catch-up
--
-- Brings the production database in line with staging by applying all changes
-- that were applied to staging but never ran on production.
--
-- Missing from production (compared to staging):
--
--   FROM 0008 — profiles.bio_photo, profiles.bio_description
--   FROM 0009a — profiles.bio_credentials
--   FROM 0009b — roster_records address columns
--   FROM 0010  — profiles.bio_years_experience, profiles.bio_students_trained
--   FROM 0013  — decrement_stock_if_available(), restore_stock() functions
--   FROM 0016  — mark_invoice_paid() function
--   FROM 0018  — PEARS® and ACLS EP cert types + class types
--   FROM 0023  — RLS on all 26 tables, scoped access policies,
--                function REVOKEs, foreign-key indexes
--
-- Safe to re-run: all DDL uses IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- =============================================================================


-- =============================================================================
-- PART 1 — Missing columns
-- =============================================================================

-- ── From 0008: staff bio photo and description on profiles ───────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_photo       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bio_description TEXT DEFAULT NULL;

-- ── From 0009a: bio credentials on profiles ──────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_credentials TEXT NULL;

-- ── From 0009b: address fields on roster_records ─────────────────────────────
-- Required by the Enrollware student import export (bookmarklet).
ALTER TABLE roster_records
  ADD COLUMN IF NOT EXISTS address_1 TEXT,
  ADD COLUMN IF NOT EXISTS address_2 TEXT,
  ADD COLUMN IF NOT EXISTS city      TEXT,
  ADD COLUMN IF NOT EXISTS state     TEXT,
  ADD COLUMN IF NOT EXISTS zip       TEXT;

-- ── From 0010: bio stats on profiles ─────────────────────────────────────────
-- Displayed on the lead instructor's section of the /about page.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio_years_experience TEXT NULL,
  ADD COLUMN IF NOT EXISTS bio_students_trained TEXT NULL;


-- =============================================================================
-- PART 2 — Missing functions
-- =============================================================================

-- ── From 0013: decrement_stock_if_available ───────────────────────────────────
-- Atomically locks the variant row and decrements stock_quantity only if
-- enough stock is available. Returns true on success, false on insufficient
-- stock. Called from the merch checkout API route.
CREATE OR REPLACE FUNCTION decrement_stock_if_available(
  p_variant_id uuid,
  p_amount     int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock int;
BEGIN
  SELECT stock_quantity INTO v_stock
  FROM product_variants
  WHERE id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_stock < p_amount THEN
    RETURN false;
  END IF;

  UPDATE product_variants
     SET stock_quantity = stock_quantity - p_amount
   WHERE id = p_variant_id;

  RETURN true;
END;
$$;

-- ── From 0013: restore_stock ──────────────────────────────────────────────────
-- Adds units back to stock_quantity. Used to roll back a successful
-- decrement_stock_if_available when a downstream step fails.
CREATE OR REPLACE FUNCTION restore_stock(
  p_variant_id uuid,
  p_amount     int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_variants
     SET stock_quantity = stock_quantity + p_amount
   WHERE id = p_variant_id;
END;
$$;

-- ── From 0016: mark_invoice_paid ──────────────────────────────────────────────
-- Atomically:
--   1. Locks the invoices row (SELECT FOR UPDATE).
--   2. Verifies the invoice exists and has status = 'sent'.
--   3. Sets invoice status = 'paid', paid_at = now().
--   4. Inserts one bookings row per student slot (booking_source = 'invoice').
--   5. Inserts an invoice_activity_log row for the action.
-- Returns a jsonb result with { success: true, paid_at: <timestamp> }.
-- Called only from /api/invoices/mark-paid using the service-role client.
CREATE OR REPLACE FUNCTION mark_invoice_paid(
  p_invoice_id uuid,
  p_actor_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice  invoices%ROWTYPE;
  v_paid_at  timestamptz := now();
BEGIN
  -- Lock the invoice row to prevent concurrent calls from double-inserting
  -- bookings and double-marking the invoice paid.
  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status <> 'sent' THEN
    -- Invoice is already paid, cancelled, or in an unexpected state.
    RAISE EXCEPTION 'invoice_not_sent' USING ERRCODE = 'P0001';
  END IF;

  -- Mark the invoice as paid.
  UPDATE invoices
  SET status  = 'paid',
      paid_at = v_paid_at
  WHERE id = p_invoice_id;

  -- Insert one booking row per student slot.
  -- customer_id = instructor_id: the instructor acts as the booking agent.
  INSERT INTO bookings (session_id, customer_id, invoice_id, booking_source, created_by)
  SELECT
    v_invoice.class_session_id,
    v_invoice.instructor_id,
    p_invoice_id,
    'invoice',
    p_actor_id
  FROM generate_series(1, v_invoice.student_count);

  -- Audit log.
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action)
  VALUES (p_invoice_id, p_actor_id, 'marked_paid');

  RETURN jsonb_build_object('success', true, 'paid_at', v_paid_at);
END;
$$;

-- Restrict all three functions: callable only from server-side API routes via
-- the service-role client. Not callable from a browser via PostgREST.
REVOKE EXECUTE ON FUNCTION decrement_stock_if_available(uuid, int) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION decrement_stock_if_available(uuid, int) TO service_role;

REVOKE EXECUTE ON FUNCTION restore_stock(uuid, int) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION restore_stock(uuid, int) TO service_role;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(uuid, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_invoice_paid(uuid, uuid) TO service_role;


-- =============================================================================
-- PART 3 — Missing reference data
-- =============================================================================

-- ── From 0018: PEARS® and ACLS EP cert types ─────────────────────────────────
INSERT INTO cert_types (name, description, validity_months, issuing_body, active)
VALUES
  ('PEARS® Provider eCard',
   'AHA Pediatric Emergency Assessment, Recognition, and Stabilization certification. Covers systematic approach to pediatric emergencies, respiratory distress, and shock recognition.',
   24, 'American Heart Association', true),

  ('PEARS® Instructor eCard',
   'AHA PEARS Instructor certification. Authorizes teaching of Pediatric Emergency Assessment, Recognition, and Stabilization courses.',
   24, 'American Heart Association', true),

  ('ACLS EP eCard',
   'AHA Advanced Cardiovascular Life Support Experienced Provider certification. For healthcare professionals with extensive ACLS experience requiring focused update training.',
   24, 'American Heart Association', true),

  ('ACLS EP Instructor eCard',
   'AHA ACLS Experienced Provider Instructor certification. Authorizes teaching of ACLS Experienced Provider courses.',
   24, 'American Heart Association', true)

ON CONFLICT (name) DO NOTHING;

-- ── From 0018: PEARS® and ACLS EP class types ─────────────────────────────────
-- All start as active=false — admin must set correct prices/durations before
-- publishing. ON CONFLICT (name) DO NOTHING makes this safe to re-run.
INSERT INTO class_types (name, description, duration_minutes, max_capacity, price, active, cert_type_id)
VALUES
  ('PEARS® Provider',
   'AHA-certified Pediatric Emergency Assessment, Recognition, and Stabilization course. Designed for healthcare providers who care for pediatric patients in settings where advanced equipment is available.',
   480, 12, 150.00, false,
   (SELECT id FROM cert_types WHERE name = 'PEARS® Provider eCard')),

  ('PEARS® Instructor',
   'AHA PEARS Instructor course. Trains and certifies instructors to teach Pediatric Emergency Assessment, Recognition, and Stabilization courses.',
   480, 12, 200.00, false,
   (SELECT id FROM cert_types WHERE name = 'PEARS® Instructor eCard')),

  ('ACLS EP',
   'AHA Advanced Cardiovascular Life Support Experienced Provider course. Focused update training for healthcare professionals with prior ACLS experience.',
   480, 12, 150.00, false,
   (SELECT id FROM cert_types WHERE name = 'ACLS EP eCard')),

  ('ACLS EP Instructor',
   'AHA ACLS Experienced Provider Instructor course. Trains and certifies instructors to teach ACLS Experienced Provider courses.',
   480, 12, 200.00, false,
   (SELECT id FROM cert_types WHERE name = 'ACLS EP Instructor eCard'))

ON CONFLICT (name) DO NOTHING;


-- =============================================================================
-- PART 4 — Row-Level Security (from 0023)
-- =============================================================================
-- Enable RLS on all 26 public tables, add scoped access policies for
-- anon/authenticated, restrict SECURITY DEFINER functions to service_role,
-- and add foreign-key indexes for the Supabase advisor warnings.

-- ── Enable RLS on every table ─────────────────────────────────────────────────

ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_types               ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_activity_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cert_types                ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_replies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_uploads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_grades             ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_feed_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings           ENABLE ROW LEVEL SECURITY;

-- payout tables already had RLS enabled — force idempotent re-enable (no-op)
ALTER TABLE instructor_earnings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_items   ENABLE ROW LEVEL SECURITY;

-- ── profiles ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_anon_read_lead_instructor" ON profiles;
CREATE POLICY "profiles_anon_read_lead_instructor" ON profiles
  FOR SELECT
  TO anon
  USING (is_lead_instructor = true AND deactivated = false);

DROP POLICY IF EXISTS "profiles_anon_email_exists_check" ON profiles;
CREATE POLICY "profiles_anon_email_exists_check" ON profiles
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "profiles_auth_read_own" ON profiles;
CREATE POLICY "profiles_auth_read_own" ON profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_anon_insert_own" ON profiles;
CREATE POLICY "profiles_anon_insert_own" ON profiles
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_auth_update_own" ON profiles;
CREATE POLICY "profiles_auth_update_own" ON profiles
  FOR UPDATE
  TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── class_sessions ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "class_sessions_anon_read_public" ON class_sessions;
CREATE POLICY "class_sessions_anon_read_public" ON class_sessions
  FOR SELECT
  TO anon, authenticated
  USING (
    status          = 'scheduled'
    AND approval_status = 'approved'
    AND starts_at   > now()
  );

-- ── class_types ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "class_types_anon_read_active" ON class_types;
CREATE POLICY "class_types_anon_read_active" ON class_types
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- ── locations ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "locations_anon_read" ON locations;
CREATE POLICY "locations_anon_read" ON locations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── contact_submissions ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "contact_submissions_anon_insert" ON contact_submissions;
CREATE POLICY "contact_submissions_anon_insert" ON contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── bookings ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "bookings_auth_read_own" ON bookings;
CREATE POLICY "bookings_auth_read_own" ON bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- ── roster_records ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "roster_records_anon_read_by_session" ON roster_records;
CREATE POLICY "roster_records_anon_read_by_session" ON roster_records
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── products / product_variants ───────────────────────────────────────────────

DROP POLICY IF EXISTS "products_anon_read_active" ON products;
CREATE POLICY "products_anon_read_active" ON products
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "product_variants_anon_read" ON product_variants;
CREATE POLICY "product_variants_anon_read" ON product_variants
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── cert_types ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cert_types_anon_read_active" ON cert_types;
CREATE POLICY "cert_types_anon_read_active" ON cert_types
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- ── social_feed_cache ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "social_feed_cache_anon_read" ON social_feed_cache;
CREATE POLICY "social_feed_cache_anon_read" ON social_feed_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── orders ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "orders_auth_read_own" ON orders;
CREATE POLICY "orders_auth_read_own" ON orders
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- ── Restrict SECURITY DEFINER functions to service_role ──────────────────────
-- All five functions are called only from server-side API routes via the
-- service-role client — they should not be callable directly from a browser.

REVOKE EXECUTE ON FUNCTION book_spot(uuid, uuid, text, uuid)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION book_spot(uuid, uuid, text, uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION decrement_stock_if_available(uuid, int)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION decrement_stock_if_available(uuid, int)
  TO service_role;

REVOKE EXECUTE ON FUNCTION restore_stock(uuid, int)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION restore_stock(uuid, int)
  TO service_role;

REVOKE EXECUTE ON FUNCTION regenerate_instructor_access_codes()
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION regenerate_instructor_access_codes()
  TO service_role;

REVOKE EXECUTE ON FUNCTION reserve_instructor_payout_batch(uuid)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION reserve_instructor_payout_batch(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION mark_invoice_paid(uuid, uuid)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION mark_invoice_paid(uuid, uuid)
  TO service_role;

-- ── Foreign-key indexes ───────────────────────────────────────────────────────
-- All conditional so re-runs are safe.

-- bookings
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id   ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session_id    ON bookings(session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created_by    ON bookings(created_by);
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_by  ON bookings(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_bookings_invoice_id    ON bookings(invoice_id);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_customer_id  ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id   ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_logged_by    ON payments(logged_by);

-- certifications (FK column is customer_id, not profile_id)
CREATE INDEX IF NOT EXISTS idx_certifications_customer_id  ON certifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_certifications_session_id   ON certifications(session_id);
CREATE INDEX IF NOT EXISTS idx_certifications_cert_type_id ON certifications(cert_type_id);

-- invoices (session FK column is class_session_id)
CREATE INDEX IF NOT EXISTS idx_invoices_instructor_id    ON invoices(instructor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_class_session_id ON invoices(class_session_id);

-- invoice_activity_log
CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_invoice_id ON invoice_activity_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_actor_id   ON invoice_activity_log(actor_id);

-- class_sessions
CREATE INDEX IF NOT EXISTS idx_class_sessions_instructor_id ON class_sessions(instructor_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_class_type_id ON class_sessions(class_type_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_location_id   ON class_sessions(location_id);

-- class_types
CREATE INDEX IF NOT EXISTS idx_class_types_cert_type_id ON class_types(cert_type_id);

-- contact_replies
CREATE INDEX IF NOT EXISTS idx_contact_replies_submission_id ON contact_replies(submission_id);
CREATE INDEX IF NOT EXISTS idx_contact_replies_sent_by       ON contact_replies(sent_by);

-- roster_records
CREATE INDEX IF NOT EXISTS idx_roster_records_session_id ON roster_records(session_id);
CREATE INDEX IF NOT EXISTS idx_roster_records_booking_id ON roster_records(booking_id);

-- roster_uploads (no uploaded_by column — only invoice_id and session_id FKs exist)
CREATE INDEX IF NOT EXISTS idx_roster_uploads_invoice_id ON roster_uploads(invoice_id);
CREATE INDEX IF NOT EXISTS idx_roster_uploads_session_id ON roster_uploads(session_id);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);

-- product_variants
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- stock_adjustments
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant_id  ON stock_adjustments(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_adjusted_by ON stock_adjustments(adjusted_by);

-- api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_profile_id ON api_keys(profile_id);

-- instructor_earnings (payout_batch_id/payout_item_id are plain UUID columns, not FKs)
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_instructor_id ON instructor_earnings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_booking_id    ON instructor_earnings(booking_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_invoice_id_e  ON instructor_earnings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_payment_id    ON instructor_earnings(payment_id);

-- instructor_payout_batches
CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_created_by ON instructor_payout_batches(created_by);

-- instructor_payout_items
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_batch_id      ON instructor_payout_items(payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_instructor_id ON instructor_payout_items(instructor_id);
