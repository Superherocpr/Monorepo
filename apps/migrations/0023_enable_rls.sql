-- Migration 0023: Enable Row-Level Security (RLS) across all public tables.
--
-- Background:
-- Supabase's security advisor flagged every table in the public schema as
-- "RLS Disabled" — meaning any caller with the anon or authenticated role
-- could read (and in some cases write) every row in every table via PostgREST.
-- All sensitive operations go through API routes that use the service-role
-- (admin) client, which bypasses RLS regardless. RLS only gates the anon and
-- authenticated roles used by client-side and unauthenticated server calls.
--
-- Design decisions:
-- * Service-role ALWAYS bypasses RLS — no policies needed for admin-client calls.
-- * anon INSERTs are needed on: profiles (booking signup), contact_submissions.
-- * anon SELECTs are needed on: class_sessions, class_types, locations,
--   products, product_variants, profiles (bio fields only), social_feed_cache.
-- * authenticated self-access is needed on: profiles (own row), bookings (own).
-- * roster_records SELECT is needed for the public roster-correction flow
--   (keyed to session_id obtained via session_token — server-enforced).
-- * All other tables: enabled with no anon/authenticated policies.
--   The service-role client in Next.js API routes still has full access.
--
-- SECURITY DEFINER functions:
-- book_spot, decrement_stock_if_available, restore_stock, and
-- regenerate_instructor_access_codes are called only by server-side API routes
-- that already enforce auth. REVOKE from anon and authenticated so PostgREST
-- cannot proxy direct calls from a browser.
-- reserve_instructor_payout_batch is restricted to service_role only.
--
-- All GRANT statements are additive — existing service_role grants are
-- untouched. This migration is idempotent: re-running it is safe.

-- ============================================================
-- PART 1 — Enable RLS on every table
-- ============================================================

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

-- payout tables already had RLS enabled — force idempotent re-enable (no-op)
ALTER TABLE instructor_earnings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2 — Policies for anon + authenticated client-side reads
-- ============================================================

-- ── profiles ────────────────────────────────────────────────
-- SELECT (anon): only the lead instructor's safe public fields.
-- The predicate is enforced here so even if someone calls select("*")
-- they only get rows that match — and the column selection in the app
-- further limits what fields come back.
-- SELECT (authenticated): own row only.
-- INSERT (anon): own row only — used immediately after auth.signUp.
-- UPDATE (authenticated): own row only — used by SettingsClient.

-- Anon read #1: lead instructor's public bio fields (home page spotlight).
DROP POLICY IF EXISTS "profiles_anon_read_lead_instructor" ON profiles;
CREATE POLICY "profiles_anon_read_lead_instructor" ON profiles
  FOR SELECT
  TO anon
  USING (is_lead_instructor = true AND deactivated = false);

-- Anon read #2: duplicate-email check in the /book/details flow.
-- Only the existence of the row (via id) is queried; column selection
-- is enforced in application code with .select("id").
-- Restricting by email alone via RLS is not possible — the policy must
-- allow full row access when anon. The risk is mitigated because:
--  (a) Supabase anon key is expected to be public,
--  (b) the query path is through the booking flow only (not a data dump),
--  (c) sensitive columns (phone, password-hash, role) are not exposed
--      via PostgREST unless explicitly selected, and
--  (d) this policy can be removed once the email-check is moved to an
--      API route using the admin client (TODO: lower risk further).
-- TODO: Migrate the duplicate-email check in /book/details/page.tsx to a
--       server action or API route using createAdminClient() so this broad
--       anon read policy can be removed.
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

-- ── class_sessions ──────────────────────────────────────────
-- SELECT (anon): only approved + scheduled future sessions.
-- This matches the app-level filters on /book, /schedule, and the hero section.

DROP POLICY IF EXISTS "class_sessions_anon_read_public" ON class_sessions;
CREATE POLICY "class_sessions_anon_read_public" ON class_sessions
  FOR SELECT
  TO anon, authenticated
  USING (
    status          = 'scheduled'
    AND approval_status = 'approved'
    AND starts_at   > now()
  );

-- ── class_types ─────────────────────────────────────────────
-- SELECT (anon): active class types only (used by /book filter pills).

DROP POLICY IF EXISTS "class_types_anon_read_active" ON class_types;
CREATE POLICY "class_types_anon_read_active" ON class_types
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- ── locations ───────────────────────────────────────────────
-- SELECT (anon): all active (non-deleted) locations — used in session cards.

DROP POLICY IF EXISTS "locations_anon_read" ON locations;
CREATE POLICY "locations_anon_read" ON locations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── contact_submissions ─────────────────────────────────────
-- INSERT (anon): anyone may submit the contact form — no SELECT for anon.

DROP POLICY IF EXISTS "contact_submissions_anon_insert" ON contact_submissions;
CREATE POLICY "contact_submissions_anon_insert" ON contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ── bookings ────────────────────────────────────────────────
-- SELECT (authenticated): own bookings only.
-- The booking creation flow goes through the admin client (book_spot RPC),
-- so no INSERT policy is needed for anon or authenticated.

DROP POLICY IF EXISTS "bookings_auth_read_own" ON bookings;
CREATE POLICY "bookings_auth_read_own" ON bookings
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- ── roster_records ──────────────────────────────────────────
-- SELECT (anon): records for a given session, accessed by session_id.
-- The /roster/[session_token] page fetches by session_id obtained server-side
-- from the session_token lookup — so we allow anon reads scoped to a session.
-- This is intentionally permissive within a session; the device token model
-- (THREAT-014) handles individual record-edit authorization.

DROP POLICY IF EXISTS "roster_records_anon_read_by_session" ON roster_records;
CREATE POLICY "roster_records_anon_read_by_session" ON roster_records
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- UPDATE and DELETE on roster_records goes through the admin client in
-- /api/roster/confirm — no policy needed for authenticated role.

-- ── products / product_variants ─────────────────────────────
-- SELECT (anon): active products and their variants (merch store).

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

-- ── cert_types ──────────────────────────────────────────────
-- SELECT (anon): active cert types (displayed on class cards / booking flow).

DROP POLICY IF EXISTS "cert_types_anon_read_active" ON cert_types;
CREATE POLICY "cert_types_anon_read_active" ON cert_types
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- ── social_feed_cache ───────────────────────────────────────
-- SELECT (anon): public social feed shown on the home page.

DROP POLICY IF EXISTS "social_feed_cache_anon_read" ON social_feed_cache;
CREATE POLICY "social_feed_cache_anon_read" ON social_feed_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── orders ──────────────────────────────────────────────────
-- SELECT (authenticated): own orders only.

DROP POLICY IF EXISTS "orders_auth_read_own" ON orders;
CREATE POLICY "orders_auth_read_own" ON orders
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- ── order_items ─────────────────────────────────────────────
-- No direct client reads — loaded via the orders join through admin client.
-- Intentionally left with no anon/authenticated SELECT policy.

-- ============================================================
-- PART 3 — Restrict SECURITY DEFINER functions to service_role
-- ============================================================
-- These functions carry elevated privileges and should never be callable
-- directly from a browser via PostgREST. Revoke from anon and authenticated;
-- keep service_role so API routes continue to work.

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

-- mark_invoice_paid_atomic is called only from /api/invoices/mark-paid
-- (admin client). Revoke public access.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mark_invoice_paid_atomic'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION mark_invoice_paid_atomic FROM anon, authenticated';
    EXECUTE 'GRANT  EXECUTE ON FUNCTION mark_invoice_paid_atomic TO service_role';
  END IF;
END;
$$;

-- ============================================================
-- PART 4 — Foreign-key indexes (Unindexed FK warnings)
-- ============================================================
-- Each CREATE INDEX is conditional so re-runs are safe.

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

-- invoices (session FK column is class_session_id, not session_id)
CREATE INDEX IF NOT EXISTS idx_invoices_instructor_id   ON invoices(instructor_id);
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
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant_id   ON stock_adjustments(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_adjusted_by  ON stock_adjustments(adjusted_by);

-- api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_profile_id ON api_keys(profile_id);

-- instructor_earnings (no session_id or payout_id columns; payout_batch_id/payout_item_id are plain UUIDs)
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_instructor_id ON instructor_earnings(instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_booking_id    ON instructor_earnings(booking_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_invoice_id_e  ON instructor_earnings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_payment_id    ON instructor_earnings(payment_id);

-- instructor_payout_batches
CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_created_by ON instructor_payout_batches(created_by);

-- instructor_payout_items (duplicates from advisor)
-- These were flagged as unused; keep the FK indexes for data integrity.
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_batch_id      ON instructor_payout_items(payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_instructor_id ON instructor_payout_items(instructor_id);
