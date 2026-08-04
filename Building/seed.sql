-- =============================================================================
-- Superhero CPR — Booking Flow Mock Seed (Idempotent)
-- Run in the Supabase SQL editor (service role / superuser required for auth.users).
--
-- Fix applied vs. AI-generated version:
--   The original used `(base_uuid::text || lpad(n::text, 2, '0'))::uuid` which
--   concatenates onto an already-complete 36-character UUID string, producing
--   malformed UUIDs like '44444444-0000-0000-0000-00000000000001' (too long).
--   All UUID construction is now rebuilt from the known prefix:
--     ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
-- =============================================================================

-- extensions schema is where Supabase installs pgcrypto (crypt, gen_salt)
SET search_path TO public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

DO $$
DECLARE
  -- Instructor (hardcoded so you can create a real auth user with this ID later)
  instructor_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  instance_id   uuid := '00000000-0000-0000-0000-000000000000'::uuid;

  -- Locations
  loc_home     uuid := '11111111-0000-0000-0000-000000000001'::uuid;
  loc_hospital uuid := '11111111-0000-0000-0000-000000000002'::uuid;

  -- Cert types (13 AHA eCard types + 1 SuperHeroCPR branded cert)
  cert_hs_firstaid       uuid := '55555555-0000-0000-0000-000000000001'::uuid;
  cert_hs_cpr_aed        uuid := '55555555-0000-0000-0000-000000000002'::uuid;
  cert_hs_fa_cpr_aed     uuid := '55555555-0000-0000-0000-000000000003'::uuid;
  cert_hs_peds           uuid := '55555555-0000-0000-0000-000000000004'::uuid;
  cert_hs_k12            uuid := '55555555-0000-0000-0000-000000000005'::uuid;
  cert_bls_provider      uuid := '55555555-0000-0000-0000-000000000006'::uuid;
  cert_acls_provider     uuid := '55555555-0000-0000-0000-000000000007'::uuid;
  cert_pals_provider     uuid := '55555555-0000-0000-0000-000000000008'::uuid;
  cert_hs_instructor     uuid := '55555555-0000-0000-0000-000000000009'::uuid;
  cert_bls_instructor    uuid := '55555555-0000-0000-0000-000000000010'::uuid;
  cert_acls_instructor   uuid := '55555555-0000-0000-0000-000000000011'::uuid;
  cert_pals_instructor   uuid := '55555555-0000-0000-0000-000000000012'::uuid;
  cert_advisor_bls       uuid := '55555555-0000-0000-0000-000000000013'::uuid;
  cert_superherocpr      uuid := '55555555-0000-0000-0000-000000000014'::uuid;

  -- Class types (4 active — matching AHA course names)
  ct_bls        uuid := '22222222-0000-0000-0000-000000000001'::uuid;
  ct_heartsaver uuid := '22222222-0000-0000-0000-000000000002'::uuid;
  ct_pediatric  uuid := '22222222-0000-0000-0000-000000000003'::uuid;
  ct_renewal    uuid := '22222222-0000-0000-0000-000000000004'::uuid;

  -- Sessions (8 upcoming)
  s1 uuid := '33333333-0000-0000-0000-000000000001'::uuid; -- empty       (BLS, home)
  s2 uuid := '33333333-0000-0000-0000-000000000002'::uuid; -- empty       (Heartsaver, hospital)
  s3 uuid := '33333333-0000-0000-0000-000000000003'::uuid; -- partial     (Pediatric, home, 6/14)
  s4 uuid := '33333333-0000-0000-0000-000000000004'::uuid; -- partial     (Renewal, hospital, 9/20)
  s5 uuid := '33333333-0000-0000-0000-000000000005'::uuid; -- nearly full (BLS, hospital, 10/12)
  s6 uuid := '33333333-0000-0000-0000-000000000006'::uuid; -- nearly full (Heartsaver, home, 14/16)
  s7 uuid := '33333333-0000-0000-0000-000000000007'::uuid; -- FULL        (Renewal, hospital, 20/20)
  s8 uuid := '33333333-0000-0000-0000-000000000008'::uuid; -- partial     (Renewal, home, 8/20)

  base_start date := date_trunc('day', now())::date;
  i int;
BEGIN

  -- ============================================================================
  -- 1. AUTH USERS + PROFILES
  --    Customers use prefix '44444444-0000-0000-0000-' + 12-char zero-padded n
  -- ============================================================================


  INSERT INTO auth.users (
    id, instance_id, aud, role,
    'authenticated',
    'instructor@test.local',
    crypt('TestPass1234!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Instructor profile
  INSERT INTO profiles (
    id, first_name, last_name, email, phone,
    role, is_lead_instructor,
    archived, deactivated,
    created_at, updated_at
  )
  VALUES (
    instructor_id, 'Alex', 'Martinez', 'instructor@test.local', '813-555-0100',
    'instructor', true,
    false, false,
    now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- 20 customer auth users + profiles
  -- UUID pattern: '44444444-0000-0000-0000-000000000001' through '...000000000020'
  FOR i IN 1..20 LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role,
      email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    VALUES (
      ('44444444-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      instance_id,
      'authenticated',
      'authenticated',
      ('customer' || i::text || '@test.local'),
      crypt('TestPass1234!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (
      id, first_name, last_name, email, phone,
      role, is_lead_instructor,
      archived, deactivated,
      created_at, updated_at
    )
    VALUES (
      ('44444444-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'Test', ('Customer ' || i::text),
      ('customer' || i::text || '@test.local'),
      ('813-555-01' || lpad(i::text, 2, '0')),
      'customer', false,
      false, false,
      now(), now()
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- ============================================================================
  -- 2. CERT TYPES (13 AHA eCard types + 1 SuperHeroCPR branded cert)
  -- Names must exactly match CERT_CONFIGS in apps/web/lib/cert-utils.ts.
  -- ============================================================================
  INSERT INTO cert_types (id, name, description, validity_months, issuing_body, active)
  VALUES
    (cert_hs_firstaid,     'Heartsaver® First Aid eCard',                    'AHA Heartsaver First Aid certification.',                          24, 'American Heart Association', true),
    (cert_hs_cpr_aed,      'Heartsaver® CPR AED eCard',                      'AHA Heartsaver CPR and AED certification.',                        24, 'American Heart Association', true),
    (cert_hs_fa_cpr_aed,   'Heartsaver® First Aid CPR AED eCard',            'AHA Heartsaver combined First Aid, CPR, and AED certification.',    24, 'American Heart Association', true),
    (cert_hs_peds,         'Heartsaver® Pediatric First Aid CPR AED eCard',  'AHA Heartsaver pediatric certification.',                          24, 'American Heart Association', true),
    (cert_hs_k12,          'Heartsaver® for K-12 Schools eCard',             'AHA Heartsaver certification for school staff.',                   24, 'American Heart Association', true),
    (cert_bls_provider,    'BLS Provider eCard',                             'AHA Basic Life Support for healthcare providers.',                 24, 'American Heart Association', true),
    (cert_acls_provider,   'ACLS Provider eCard',                            'AHA Advanced Cardiovascular Life Support certification.',          24, 'American Heart Association', true),
    (cert_pals_provider,   'PALS Provider eCard',                            'AHA Pediatric Advanced Life Support certification.',               24, 'American Heart Association', true),
    (cert_hs_instructor,   'Heartsaver® Instructor eCard',                   'AHA authorization to teach Heartsaver-level courses.',             24, 'American Heart Association', true),
    (cert_bls_instructor,  'BLS Instructor eCard',                           'AHA authorization to teach BLS Provider courses.',                 24, 'American Heart Association', true),
    (cert_acls_instructor, 'ACLS Instructor eCard',                          'AHA authorization to teach ACLS courses.',                        24, 'American Heart Association', true),
    (cert_pals_instructor, 'PALS Instructor eCard',                          'AHA authorization to teach PALS courses.',                        24, 'American Heart Association', true),
    (cert_advisor_bls,     'Advisor: BLS eCard',                             'AHA BLS Training Site Faculty/Advisor designation.',              24, 'American Heart Association', true),
    (cert_superherocpr,    'SuperHeroCPR Certificate',                       'SuperHeroCPR-issued CPR/First Aid completion certificate.',        24, 'SuperHeroCPR',               true)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 3. CLASS TYPES (4 active courses — official AHA names, linked to cert types)
  -- ============================================================================
  INSERT INTO class_types (id, name, description, duration_minutes, max_capacity, price, active, cert_type_id)
  VALUES
    (ct_bls,        'BLS Provider',
     'AHA-certified Basic Life Support for healthcare providers. Covers high-quality CPR for adults, children, and infants, AED use, and team resuscitation.',
     240, 12, 65.00, true, cert_bls_provider),
    (ct_heartsaver, 'Heartsaver® CPR AED',
     'AHA-certified CPR and AED training for the general public and workplace responders. Covers adult, child, and infant CPR and AED use.',
     180, 16, 55.00, true, cert_hs_cpr_aed),
    (ct_pediatric,  'Heartsaver® Pediatric First Aid CPR AED',
     'AHA-certified pediatric course for childcare providers, parents, and school staff. Covers infant and child CPR, AED use, choking relief, and pediatric first aid.',
     210, 14, 60.00, true, cert_hs_peds),
    (ct_renewal,    'Heartsaver® First Aid CPR AED',
     'AHA-certified combined First Aid, CPR, and AED course for the general public and workplace settings.',
     180, 16, 55.00, true, cert_hs_fa_cpr_aed)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 4. LOCATIONS (2 rows)
  -- ============================================================================
  INSERT INTO locations (id, name, address, city, state, zip, notes, is_home_base)
  VALUES
    (loc_home,     'Superhero CPR Home Base', '4830 W Kennedy Blvd',  'Tampa', 'FL', '33609', NULL, true),
    (loc_hospital, 'St. Joseph''s Hospital',  '3001 W MLK Jr Blvd',   'Tampa', 'FL', '33607', NULL, false)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 5. CLASS SESSIONS (8 upcoming, all approved + scheduled)
  -- ============================================================================

  -- s1: empty — BLS, home base (max 12, 0 bookings)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s1, ct_bls, instructor_id, loc_home,

    (base_start + interval '12 days') + time '10:00',
    (base_start + interval '12 days') + time '13:00',
    16, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s3: partial — Pediatric, home base (max 14, 6 bookings → 8 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s3, ct_pediatric, instructor_id, loc_home,
    (base_start + interval '18 days') + time '09:30',
    (base_start + interval '18 days') + time '13:00',
    14, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s4: partial — Renewal, hospital (max 20, 9 bookings → 11 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s4, ct_renewal, instructor_id, loc_hospital,
    (base_start + interval '25 days') + time '14:00',
    (base_start + interval '25 days') + time '16:00',
    20, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s5: nearly full — BLS, hospital (max 12, 10 bookings → 2 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s5, ct_bls, instructor_id, loc_hospital,
    (base_start + interval '33 days') + time '09:00',
    (base_start + interval '33 days') + time '11:30',
    12, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s6: nearly full — Heartsaver, home base (max 16, 14 bookings → 2 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s6, ct_heartsaver, instructor_id, loc_home,
    (base_start + interval '39 days') + time '13:00',
    (base_start + interval '39 days') + time '15:30',
    16, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s7: FULL — Renewal, hospital (max 20, 20 bookings → 0 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s7, ct_renewal, instructor_id, loc_hospital,
    (base_start + interval '46 days') + time '10:00',
    (base_start + interval '46 days') + time '12:00',
    20, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- s8: partial — Renewal, home base (max 20, 8 bookings → 12 remaining)
  INSERT INTO class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status)
  VALUES (s8, ct_renewal, instructor_id, loc_home,
    (base_start + interval '55 days') + time '15:00',
    (base_start + interval '55 days') + time '17:00',
    20, 'scheduled', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 6. BOOKINGS + PAYMENTS
  --    Booking IDs: '55555555-0000-0000-0000-' + lpad(offset+n, 12, '0')
  --    Payment IDs: '66666666-0000-0000-0000-' + lpad(offset+n, 12, '0')
  --    Customer IDs: '44444444-0000-0000-0000-' + lpad(n, 12, '0')
  --    Each booking gets 1 matching payment (status=completed, type=online).
  --    Offsets keep IDs unique across sessions: s3=200, s4=300, s5=400, s6=500, s7=600, s8=700
  -- ============================================================================

  -- s1, s2: intentionally no bookings (empty sessions)

  -- s3: 6 bookings — customers 1–6 — $60.00 (Pediatric price)
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((200 + n)::text, 12, '0'))::uuid,
    s3,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 6) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((200 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((200 + n)::text, 12, '0'))::uuid,
    60.00, 'completed', 'online',
    ('FAKE-TXN-S3-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 6) AS n
  ON CONFLICT (id) DO NOTHING;

  -- s4: 9 bookings — customers 1–9 — $45.00 (Renewal price)
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((300 + n)::text, 12, '0'))::uuid,
    s4,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 9) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((300 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((300 + n)::text, 12, '0'))::uuid,
    45.00, 'completed', 'online',
    ('FAKE-TXN-S4-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 9) AS n
  ON CONFLICT (id) DO NOTHING;

  -- s5: 10 bookings — customers 1–10 — $65.00 (BLS price)
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((400 + n)::text, 12, '0'))::uuid,
    s5,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 10) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((400 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((400 + n)::text, 12, '0'))::uuid,
    65.00, 'completed', 'online',
    ('FAKE-TXN-S5-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 10) AS n
  ON CONFLICT (id) DO NOTHING;

  -- s6: 14 bookings — customers 1–14 — $55.00 (Heartsaver price)
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((500 + n)::text, 12, '0'))::uuid,
    s6,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 14) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((500 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((500 + n)::text, 12, '0'))::uuid,
    55.00, 'completed', 'online',
    ('FAKE-TXN-S6-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 14) AS n
  ON CONFLICT (id) DO NOTHING;

  -- s7: 20 bookings — customers 1–20 — $45.00 (Renewal price) — FULL
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((600 + n)::text, 12, '0'))::uuid,
    s7,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 20) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((600 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((600 + n)::text, 12, '0'))::uuid,
    45.00, 'completed', 'online',
    ('FAKE-TXN-S7-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 20) AS n
  ON CONFLICT (id) DO NOTHING;

  -- s8: 8 bookings — customers 1–8 — $45.00 (Renewal price)
  INSERT INTO bookings (id, session_id, customer_id, booking_source, cancelled, created_at, updated_at)
  SELECT
    ('55555555-0000-0000-0000-' || lpad((700 + n)::text, 12, '0'))::uuid,
    s8,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'online', false, now(), now()
  FROM generate_series(1, 8) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (id, customer_id, booking_id, amount, status, payment_type, paypal_transaction_id, created_at)
  SELECT
    ('66666666-0000-0000-0000-' || lpad((700 + n)::text, 12, '0'))::uuid,
    ('44444444-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('55555555-0000-0000-0000-' || lpad((700 + n)::text, 12, '0'))::uuid,
    45.00, 'completed', 'online',
    ('FAKE-TXN-S8-' || lpad(n::text, 2, '0')),
    now()
  FROM generate_series(1, 8) AS n
  ON CONFLICT (id) DO NOTHING;

END $$;

-- =============================================================================
-- CONTACT SUBMISSIONS — mock data for testing /admin/contact
-- Mix of inquiry types, replied and unanswered, with one thread of replies.
-- Uses fixed UUIDs with prefix cc (contact) and dd (replies).
-- sent_by references the instructor profile (only profile in seed).
-- =============================================================================

DO $$
DECLARE
  staff_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;

  -- Contact submission UUIDs
  c1 uuid := 'cccccccc-0000-0000-0000-000000000001'::uuid; -- General Question, unanswered
  c2 uuid := 'cccccccc-0000-0000-0000-000000000002'::uuid; -- Group Booking, unanswered
  c3 uuid := 'cccccccc-0000-0000-0000-000000000003'::uuid; -- Corporate Training, unanswered
  c4 uuid := 'cccccccc-0000-0000-0000-000000000004'::uuid; -- Certification Renewal, replied (1 reply)
  c5 uuid := 'cccccccc-0000-0000-0000-000000000005'::uuid; -- Other, replied (2 replies)
  c6 uuid := 'cccccccc-0000-0000-0000-000000000006'::uuid; -- Group Booking, replied (1 reply)
BEGIN

  -- ── Unanswered submissions ──────────────────────────────────────────────────

  INSERT INTO contact_submissions (id, name, email, phone, inquiry_type, message, replied, created_at)
  VALUES
    (
      c1,
      'Marcus Webb',
      'marcus.webb@gmail.com',
      '813-555-0201',
      'General Question',
      'Hi, I was wondering if your BLS certification is accepted at Tampa General Hospital for nursing staff credentialing. I have an interview next week and want to make sure the cert counts before I sign up. Thanks!',
      false,
      now() - interval '3 hours'
    ),
    (
      c2,
      'Sandra Okafor',
      'sandra.okafor@brightfuture.org',
      '813-555-0202',
      'Group Booking',
      'Hello, I work for Bright Future Community Center and we need to get our entire staff of 22 people certified before the end of the month. Do you offer group discounts and can you come to our facility in Ybor City? Please let me know your availability.',
      false,
      now() - interval '1 day'
    ),
    (
      c3,
      'Derek Fontaine',
      'derek.fontaine@fontainerealty.com',
      null,
      'Corporate Training',
      'We have about 40 employees at our real estate office who need annual CPR training for our corporate compliance program. Is this something you can accommodate? We would need a certificate of completion for each employee. Looking to schedule something in the next 6 weeks.',
      false,
      now() - interval '2 days'
    )
  ON CONFLICT (id) DO NOTHING;

  -- ── Replied submissions ─────────────────────────────────────────────────────

  INSERT INTO contact_submissions (id, name, email, phone, inquiry_type, message, replied, created_at)
  VALUES
    (
      c4,
      'Priya Nair',
      'priya.nair@outlook.com',
      '727-555-0203',
      'Certification Renewal',
      'My CPR cert expired 3 months ago. I am a pediatric nurse and need BLS renewal. Do you have any weekend classes coming up? I cannot do weekdays.',
      true,
      now() - interval '5 days'
    ),
    (
      c5,
      'Tom Kessler',
      'tkessler@kesslerlaw.com',
      '813-555-0204',
      'Other',
      'Hello, I am an attorney and I am preparing a case that involves CPR certification standards. Would anyone at your organization be available to serve as an expert witness or provide a written statement about AHA certification standards? This would be paid.',
      true,
      now() - interval '8 days'
    ),
    (
      c6,
      'Lena Vasquez',
      'lena.vasquez@tampaschools.edu',
      '813-555-0205',
      'Group Booking',
      'I coordinate professional development for a K-8 school with 35 teachers. We are required to have all staff CPR certified by the start of the school year. Can you accommodate a group this size on-site at the school?',
      true,
      now() - interval '12 days'
    )
  ON CONFLICT (id) DO NOTHING;

  -- ── Replies sent by staff ───────────────────────────────────────────────────

  -- c4: Priya Nair — 1 reply
  INSERT INTO contact_replies (id, submission_id, sent_by, subject, body, zoho_message_id, has_attachments, created_at)
  VALUES
    (
      'dddddddd-0000-0000-0000-000000000001'::uuid,
      c4,
      staff_id,
      'Re: Certification Renewal inquiry from Priya Nair',
      'Hi Priya, great news — we have weekend BLS renewal classes available most Saturdays. Our next opening is this Saturday at 9am at our South Tampa location. The class takes about 3.5 hours and you will leave with your AHA BLS card same day. Reply here or call us to reserve your spot. Looking forward to seeing you!',
      'MOCK-ZOHO-MSG-001',
      false,
      now() - interval '4 days'
    )
  ON CONFLICT (id) DO NOTHING;

  -- c5: Tom Kessler — 2 replies (back and forth)
  INSERT INTO contact_replies (id, submission_id, sent_by, subject, body, zoho_message_id, has_attachments, created_at)
  VALUES
    (
      'dddddddd-0000-0000-0000-000000000002'::uuid,
      c5,
      staff_id,
      'Re: Other inquiry from Tom Kessler',
      'Hi Tom, thank you for reaching out. Our lead instructor does have experience in expert witness situations involving CPR certification standards and AHA guidelines. Please send over more details about the case and your timeline and we can discuss availability and fees.',
      'MOCK-ZOHO-MSG-002',
      false,
      now() - interval '7 days'
    ),
    (
      'dddddddd-0000-0000-0000-000000000003'::uuid,
      c5,
      staff_id,
      'Re: Other inquiry from Tom Kessler',
      'Following up — did you get a chance to review our last message? Happy to jump on a call this week if that is easier. Just let us know a good time.',
      'MOCK-ZOHO-MSG-003',
      false,
      now() - interval '5 days'
    )
  ON CONFLICT (id) DO NOTHING;

  -- c6: Lena Vasquez — 1 reply
  INSERT INTO contact_replies (id, submission_id, sent_by, subject, body, zoho_message_id, has_attachments, created_at)
  VALUES
    (
      'dddddddd-0000-0000-0000-000000000004'::uuid,
      c6,
      staff_id,
      'Re: Group Booking inquiry from Lena Vasquez',
      'Hi Lena, we would love to work with your school! We regularly do on-site trainings for groups of that size. We bring all the equipment — manikins, AED trainers, everything. We just need a space that can fit groups of about 8–10 at a time (we rotate). For 35 staff we would typically run 2 sessions on the same day. Can you share some potential dates and I will check our instructor calendar?',
      'MOCK-ZOHO-MSG-004',
      false,
      now() - interval '11 days'
    )
  ON CONFLICT (id) DO NOTHING;

END $$;

-- =============================================================================
-- MERCH — products and product_variants
-- 5 products with realistic stock levels. One product is inactive to exercise
-- the inactive state in the admin UI.
-- Product UUIDs: prefix eeeeeeee
-- Variant UUIDs: prefix ffffffff (sequential across all products)
-- =============================================================================

DO $$
DECLARE
  -- Products
  p1 uuid := 'eeeeeeee-0000-0000-0000-000000000001'::uuid; -- T-Shirt         (active, normal stock)
  p2 uuid := 'eeeeeeee-0000-0000-0000-000000000002'::uuid; -- Hoodie          (active, some low stock)
  p3 uuid := 'eeeeeeee-0000-0000-0000-000000000003'::uuid; -- CPR Keychain    (active, high stock, One Size)
  p4 uuid := 'eeeeeeee-0000-0000-0000-000000000004'::uuid; -- Drawstring Bag  (active, one size nearly out)
  p5 uuid := 'eeeeeeee-0000-0000-0000-000000000005'::uuid; -- Water Bottle    (INACTIVE — for UI testing)

  -- T-Shirt variants (XS, S, M, L, XL, XXL)
  v101 uuid := 'ffffffff-0000-0000-0000-000000000101'::uuid;
  v102 uuid := 'ffffffff-0000-0000-0000-000000000102'::uuid;
  v103 uuid := 'ffffffff-0000-0000-0000-000000000103'::uuid;
  v104 uuid := 'ffffffff-0000-0000-0000-000000000104'::uuid;
  v105 uuid := 'ffffffff-0000-0000-0000-000000000105'::uuid;
  v106 uuid := 'ffffffff-0000-0000-0000-000000000106'::uuid;

  -- Hoodie variants (S, M, L, XL, XXL)
  v201 uuid := 'ffffffff-0000-0000-0000-000000000201'::uuid;
  v202 uuid := 'ffffffff-0000-0000-0000-000000000202'::uuid;
  v203 uuid := 'ffffffff-0000-0000-0000-000000000203'::uuid;
  v204 uuid := 'ffffffff-0000-0000-0000-000000000204'::uuid;
  v205 uuid := 'ffffffff-0000-0000-0000-000000000205'::uuid;

  -- Keychain variant (One Size)
  v301 uuid := 'ffffffff-0000-0000-0000-000000000301'::uuid;

  -- Drawstring Bag variants (One Size, but separate SKU for "Black" / "Red" colorways)
  v401 uuid := 'ffffffff-0000-0000-0000-000000000401'::uuid;
  v402 uuid := 'ffffffff-0000-0000-0000-000000000402'::uuid;

  -- Water Bottle variant (One Size — inactive product)
  v501 uuid := 'ffffffff-0000-0000-0000-000000000501'::uuid;

BEGIN

  -- ── Products ────────────────────────────────────────────────────────────────

  INSERT INTO products (id, name, description, price, image_url, active, low_stock_threshold, created_at)
  VALUES
    (
      p1,
      'Superhero CPR T-Shirt',
      'Soft 100% cotton tee with the Superhero CPR logo on the chest. Available in sizes XS–XXL.',
      25.00,
      null,
      true,
      5,
      now() - interval '90 days'
    ),
    (
      p2,
      'Superhero CPR Hoodie',
      'Heavyweight pullover hoodie. Front kangaroo pocket. Superhero CPR logo embroidered on the left chest.',
      55.00,
      null,
      true,
      3,
      now() - interval '60 days'
    ),
    (
      p3,
      'CPR Steps Keychain',
      'Laminated quick-reference CPR steps card attached to a carabiner keychain. Great giveaway item.',
      8.00,
      null,
      true,
      10,
      now() - interval '45 days'
    ),
    (
      p4,
      'Superhero CPR Drawstring Bag',
      'Lightweight cinch bag, perfect for bringing to class. Available in black and red.',
      18.00,
      null,
      true,
      4,
      now() - interval '30 days'
    ),
    (
      p5,
      'Superhero CPR Water Bottle',
      'Stainless steel 20 oz insulated water bottle with the Superhero CPR shield logo.',
      32.00,
      null,
      false,  -- inactive — discontinued colorway, kept for order history
      5,
      now() - interval '180 days'
    )
  ON CONFLICT (id) DO NOTHING;

  -- ── Variants ────────────────────────────────────────────────────────────────

  -- T-Shirt: healthy stock across the board
  INSERT INTO product_variants (id, product_id, size, stock_quantity)
  VALUES
    (v101, p1, 'XS',  8),
    (v102, p1, 'S',  14),
    (v103, p1, 'M',  22),
    (v104, p1, 'L',  18),
    (v105, p1, 'XL', 11),
    (v106, p1, 'XXL', 6)
  ON CONFLICT (id) DO NOTHING;

  -- Hoodie: M and L healthy, small sizes low, XXL nearly out
  INSERT INTO product_variants (id, product_id, size, stock_quantity)
  VALUES
    (v201, p2, 'S',    3),  -- at threshold (amber)
    (v202, p2, 'M',   12),
    (v203, p2, 'L',   15),
    (v204, p2, 'XL',   7),
    (v205, p2, 'XXL',  1)   -- below threshold (amber/red)
  ON CONFLICT (id) DO NOTHING;

  -- Keychain: high stock single SKU
  INSERT INTO product_variants (id, product_id, size, stock_quantity)
  VALUES
    (v301, p3, 'One Size', 150)
  ON CONFLICT (id) DO NOTHING;

  -- Drawstring Bag: black healthy, red nearly out (exercises low-stock pill)
  INSERT INTO product_variants (id, product_id, size, stock_quantity)
  VALUES
    (v401, p4, 'Black',  20),
    (v402, p4, 'Red',     2)   -- below threshold (amber)
  ON CONFLICT (id) DO NOTHING;

  -- Water Bottle: zero stock (inactive product with 0 stock exercises that badge combo)
  INSERT INTO product_variants (id, product_id, size, stock_quantity)
  VALUES
    (v501, p5, 'One Size', 0)
  ON CONFLICT (id) DO NOTHING;

END $$;
