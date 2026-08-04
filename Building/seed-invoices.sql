-- =============================================================================
-- Superhero CPR — Invoice Mock Seed (Idempotent)
-- Run in the Supabase SQL editor (service role required).
--
-- Prerequisites: The main seed.sql must have been run first.
-- Depends on: instructor_id, sessions s1–s4, and locations from seed.sql.
--
-- Creates 4 invoices covering all testable states:
--   INV-00001 — sent, individual, PayPal         (actions available)
--   INV-00002 — sent, group, Square              (actions available, custom price)
--   INV-00003 — paid, individual, Stripe         (no actions, paid date shown)
--   INV-00004 — cancelled, group, Venmo Business (no actions, re-issue link shown)
--
-- Each invoice has activity log entries so the timeline renders.
-- =============================================================================

DO $$
DECLARE
  instructor_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;

  -- Sessions from seed.sql
  s1 uuid := '33333333-0000-0000-0000-000000000001'::uuid; -- BLS, home
  s2 uuid := '33333333-0000-0000-0000-000000000002'::uuid; -- Heartsaver, hospital
  s3 uuid := '33333333-0000-0000-0000-000000000003'::uuid; -- Pediatric, home
  s4 uuid := '33333333-0000-0000-0000-000000000004'::uuid; -- Renewal, hospital

  -- Invoice IDs — fixed so this script is idempotent
  inv1 uuid := 'aaaaaaaa-0000-0000-0000-000000000001'::uuid;
  inv2 uuid := 'aaaaaaaa-0000-0000-0000-000000000002'::uuid;
  inv3 uuid := 'aaaaaaaa-0000-0000-0000-000000000003'::uuid;
  inv4 uuid := 'aaaaaaaa-0000-0000-0000-000000000004'::uuid;

  three_days_ago timestamptz := now() - interval '3 days';
  two_days_ago   timestamptz := now() - interval '2 days';
  one_day_ago    timestamptz := now() - interval '1 day';
  six_hours_ago  timestamptz := now() - interval '6 hours';

BEGIN

  -- ============================================================================
  -- INVOICES
  -- ============================================================================

  -- INV-00001: Sent / Individual / PayPal — full action buttons visible
  INSERT INTO invoices (
    id, invoice_number, class_session_id, instructor_id,
    invoice_type, recipient_name, recipient_email,
    student_count, amount_per_student, custom_price, total_amount,
    payment_platform, platform_invoice_id,
    status, notes, created_at
  ) VALUES (
    inv1, 'INV-00001', s1, instructor_id,
    'individual', 'Sarah Johnson', 'sarah.johnson@testcompany.com',
    4, 75.00, false, 300.00,
    'paypal', 'PAYPAL-INV-MOCK-001',
    'sent',
    'Please complete payment at least 48 hours before class.',
    three_days_ago
  ) ON CONFLICT (id) DO NOTHING;

  -- INV-00002: Sent / Group / Square — custom price, company name shown
  INSERT INTO invoices (
    id, invoice_number, class_session_id, instructor_id,
    invoice_type, recipient_name, recipient_email, company_name,
    student_count, amount_per_student, custom_price, total_amount,
    payment_platform, platform_invoice_id,
    status, created_at
  ) VALUES (
    inv2, 'INV-00002', s2, instructor_id,
    'group', 'Mike Torres', 'mike.torres@riveroakshospital.org', 'River Oaks Hospital',
    12, 65.00, true, 700.00,
    'square', 'SQUARE-INV-MOCK-002',
    'sent',
    two_days_ago
  ) ON CONFLICT (id) DO NOTHING;

  -- INV-00003: Paid / Individual / Stripe — no actions, paid date shown
  INSERT INTO invoices (
    id, invoice_number, class_session_id, instructor_id,
    invoice_type, recipient_name, recipient_email,
    student_count, amount_per_student, custom_price, total_amount,
    payment_platform, platform_invoice_id,
    status, paid_at, created_at
  ) VALUES (
    inv3, 'INV-00003', s3, instructor_id,
    'individual', 'Dana Kim', 'dana.kim@example.com',
    2, 75.00, false, 150.00,
    'stripe', 'STRIPE-INV-MOCK-003',
    'paid', one_day_ago,
    three_days_ago
  ) ON CONFLICT (id) DO NOTHING;

  -- INV-00004: Cancelled / Group / Venmo Business — no actions, re-issue link shown
  INSERT INTO invoices (
    id, invoice_number, class_session_id, instructor_id,
    invoice_type, recipient_name, recipient_email, company_name,
    student_count, amount_per_student, custom_price, total_amount,
    payment_platform, platform_invoice_id,
    status, cancelled_at, created_at
  ) VALUES (
    inv4, 'INV-00004', s4, instructor_id,
    'group', 'Chris Nguyen', 'chris.nguyen@acmecorp.com', 'Acme Corp',
    8, 65.00, false, 520.00,
    'venmo_business', 'VENMO-INV-MOCK-004',
    'cancelled', six_hours_ago,
    three_days_ago
  ) ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- ACTIVITY LOG
  -- ============================================================================

  -- INV-00001 (sent) — created, then resent with a corrected email
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
  VALUES
    (inv1, instructor_id, 'created', null, three_days_ago),
    (inv1, instructor_id, 'sent',    null, three_days_ago + interval '2 minutes'),
    (inv1, instructor_id, 'resent',  'Resent to sarah.johnson@testcompany.com (corrected from sjohnson@oldmail.com)', two_days_ago)
  ON CONFLICT DO NOTHING;

  -- INV-00002 (sent) — created only
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
  VALUES
    (inv2, instructor_id, 'created', null, two_days_ago),
    (inv2, instructor_id, 'sent',    null, two_days_ago + interval '1 minute')
  ON CONFLICT DO NOTHING;

  -- INV-00003 (paid) — created, sent, marked paid
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
  VALUES
    (inv3, instructor_id, 'created',     null, three_days_ago),
    (inv3, instructor_id, 'sent',        null, three_days_ago + interval '1 minute'),
    (inv3, instructor_id, 'marked_paid', null, one_day_ago)
  ON CONFLICT DO NOTHING;

  -- INV-00004 (cancelled) — created, sent, cancelled
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
  VALUES
    (inv4, instructor_id, 'created',   null, three_days_ago),
    (inv4, instructor_id, 'sent',      null, three_days_ago + interval '1 minute'),
    (inv4, instructor_id, 'cancelled', null, six_hours_ago)
  ON CONFLICT DO NOTHING;

END $$;
