-- =============================================================================
-- Superhero CPR — Extended Mock Sessions (Aug–Dec 2026)
-- =============================================================================
-- ⚠️  STAGING ONLY. DO NOT RUN AGAINST PRODUCTION. ⚠️
--
-- Prerequisites:
--   seed-staging.sql must already be applied (instructors, customers, and
--   sessions 0x01–0x28 must already exist).
--
-- What this adds:
--   34 scheduled class sessions — Aug 20 through Dec 27, 2026
--   Bookings (~2–5 per session) from the existing customer pool
--   Online payments and instructor_earnings for those bookings
--
-- Idempotent — uses fixed UUIDs. Re-running skips conflicts.
--
-- Session IDs: 40000000-0000-0000-0000-000000000029  through
--              40000000-0000-0000-0000-00000000004a
-- =============================================================================

set search_path to public, extensions;

-- ── Safety check ─────────────────────────────────────────────────────────────
do $$
declare
  test_customer_count int;
begin
  select count(*) into test_customer_count
  from profiles
  where email like '%@test.superherocpr.local';

  if test_customer_count = 0 then
    raise exception
      'Safety check failed: no @test.superherocpr.local seed customers found. '
      'This script is STAGING ONLY. Run seed-staging.sql first.';
  end if;
end $$;

-- =============================================================================
-- CLASS SESSIONS — 34 sessions
--
-- Instructors (rotating through all active instructors):
--   10 = Sarah Martinez      11 = Kevin Okafor       12 = Brittany Hall
--   13 = Darnell Washington  14 = Mei-Ling Torres     15 = Jordan Price
--   16 = Tasha Nguyen        17 = Brandon Ellis       18 = Cynthia Park
--   19 = Derek Simmons       1a = Renee Foster        1b = Omar Castillo
--   1c = Vanessa Burke
--
-- Class types (active only):
--   b001 = BLS Provider (240 min / $65)
--   b002 = Heartsaver® CPR AED (180 min / $55)
--   b003 = Heartsaver® First Aid CPR AED (180 min / $55)
--   b004 = Heartsaver® Pediatric First Aid CPR AED (210 min / $60)
--
-- Locations:
--   d001 = Home Base           d002 = Tampa General
--   d003 = HCFR Station 1      d004 = St. Joseph's Hospital
--   d005 = Raymond James Stadium
--
-- Time zone: EDT (UTC−4) through Oct 31 · EST (UTC−5) from Nov 1 onward
-- =============================================================================

insert into class_sessions (
  id, class_type_id, instructor_id, location_id,
  starts_at, ends_at, max_capacity,
  status, approval_status, roster_imported, enrollware_submitted, notes
) values

-- ─── AUGUST 2026 ─────────────────────────────────────────────────────────────

  -- 0x29 · Aug 20 (Thu) · BLS · Sarah · Home Base
  ('40000000-0000-0000-0000-000000000029',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d001',
   '2026-08-20 09:00:00-04', '2026-08-20 13:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x2a · Aug 23 (Sun) · Heartsaver CPR AED · Kevin · Home Base
  ('40000000-0000-0000-0000-00000000002a',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-00000000d001',
   '2026-08-23 10:00:00-04', '2026-08-23 13:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x2b · Aug 27 (Thu) · First Aid CPR AED · Mei-Ling · Tampa General
  ('40000000-0000-0000-0000-00000000002b',
   '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000014',
   '00000000-0000-0000-0000-00000000d002',
   '2026-08-27 09:00:00-04', '2026-08-27 12:00:00-04',
   6, 'scheduled', 'approved', false, false, 'Tampa General recurring Heartsaver block.'),

  -- 0x2c · Aug 30 (Sun) · BLS · Jordan · Home Base — pending
  ('40000000-0000-0000-0000-00000000002c',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000015',
   '00000000-0000-0000-0000-00000000d001',
   '2026-08-30 10:00:00-04', '2026-08-30 14:00:00-04',
   8, 'scheduled', 'pending_approval', false, false, null),

-- ─── SEPTEMBER 2026 ──────────────────────────────────────────────────────────

  -- 0x2d · Sep 3 (Thu) · BLS · Tasha · St. Joseph's
  ('40000000-0000-0000-0000-00000000002d',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000016',
   '00000000-0000-0000-0000-00000000d004',
   '2026-09-03 09:00:00-04', '2026-09-03 13:00:00-04',
   8, 'scheduled', 'approved', false, false, 'St. Joseph''s quarterly BLS recert.'),

  -- 0x2e · Sep 6 (Sun) · Heartsaver CPR AED · Brandon · Home Base
  ('40000000-0000-0000-0000-00000000002e',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000017',
   '00000000-0000-0000-0000-00000000d001',
   '2026-09-06 10:00:00-04', '2026-09-06 13:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x2f · Sep 10 (Thu) · BLS · Sarah · Tampa General
  ('40000000-0000-0000-0000-00000000002f',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d002',
   '2026-09-10 09:00:00-04', '2026-09-10 13:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x30 · Sep 13 (Sun) · Pediatric FA CPR AED · Renee · Home Base — pending
  ('40000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-00000000001a',
   '00000000-0000-0000-0000-00000000d001',
   '2026-09-13 10:00:00-04', '2026-09-13 13:30:00-04',
   6, 'scheduled', 'pending_approval', false, false, null),

  -- 0x31 · Sep 17 (Thu) · BLS · Omar · HCFR Station 1
  ('40000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000001b',
   '00000000-0000-0000-0000-00000000d003',
   '2026-09-17 09:00:00-04', '2026-09-17 13:00:00-04',
   8, 'scheduled', 'approved', false, false, 'HCFR probationary cohort.'),

  -- 0x32 · Sep 20 (Sun) · Heartsaver CPR AED · Derek · Home Base
  ('40000000-0000-0000-0000-000000000032',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000019',
   '00000000-0000-0000-0000-00000000d001',
   '2026-09-20 10:00:00-04', '2026-09-20 13:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x33 · Sep 24 (Thu) · First Aid CPR AED · Cynthia · Raymond James
  ('40000000-0000-0000-0000-000000000033',
   '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000018',
   '00000000-0000-0000-0000-00000000d005',
   '2026-09-24 09:00:00-04', '2026-09-24 12:00:00-04',
   6, 'scheduled', 'approved', false, false, 'Raymond James stadium event staff.'),

  -- 0x34 · Sep 27 (Sun) · BLS · Kevin · Home Base
  ('40000000-0000-0000-0000-000000000034',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-00000000d001',
   '2026-09-27 10:00:00-04', '2026-09-27 14:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

-- ─── OCTOBER 2026 ────────────────────────────────────────────────────────────

  -- 0x35 · Oct 1 (Thu) · Heartsaver CPR AED · Vanessa · Tampa General
  ('40000000-0000-0000-0000-000000000035',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-00000000001c',
   '00000000-0000-0000-0000-00000000d002',
   '2026-10-01 09:00:00-04', '2026-10-01 12:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x36 · Oct 4 (Sun) · BLS · Sarah · Home Base
  ('40000000-0000-0000-0000-000000000036',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d001',
   '2026-10-04 10:00:00-04', '2026-10-04 14:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x37 · Oct 8 (Thu) · Pediatric FA CPR AED · Brittany · Home Base — pending
  ('40000000-0000-0000-0000-000000000037',
   '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-00000000d001',
   '2026-10-08 09:00:00-04', '2026-10-08 12:30:00-04',
   6, 'scheduled', 'pending_approval', false, false, null),

  -- 0x38 · Oct 11 (Sun) · BLS · Jordan · Tampa General
  ('40000000-0000-0000-0000-000000000038',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000015',
   '00000000-0000-0000-0000-00000000d002',
   '2026-10-11 10:00:00-04', '2026-10-11 14:00:00-04',
   8, 'scheduled', 'approved', false, false, 'Tampa General ER department recert.'),

  -- 0x39 · Oct 15 (Thu) · First Aid CPR AED · Brandon · Home Base
  ('40000000-0000-0000-0000-000000000039',
   '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000017',
   '00000000-0000-0000-0000-00000000d001',
   '2026-10-15 09:00:00-04', '2026-10-15 12:00:00-04',
   6, 'scheduled', 'approved', false, false, null),

  -- 0x3a · Oct 18 (Sun) · BLS · Tasha · HCFR Station 1
  ('40000000-0000-0000-0000-00000000003a',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000016',
   '00000000-0000-0000-0000-00000000d003',
   '2026-10-18 10:00:00-04', '2026-10-18 14:00:00-04',
   8, 'scheduled', 'approved', false, false, 'HCFR Station 1 annual recert.'),

  -- 0x3b · Oct 22 (Thu) · Heartsaver CPR AED · Darnell · Home Base
  ('40000000-0000-0000-0000-00000000003b',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-00000000d001',
   '2026-10-22 09:00:00-04', '2026-10-22 12:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x3c · Oct 25 (Sun) · BLS · Mei-Ling · Home Base
  ('40000000-0000-0000-0000-00000000003c',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000014',
   '00000000-0000-0000-0000-00000000d001',
   '2026-10-25 10:00:00-04', '2026-10-25 14:00:00-04',
   8, 'scheduled', 'approved', false, false, null),

-- ─── NOVEMBER 2026 (EST = UTC−5 from Nov 1) ──────────────────────────────────

  -- 0x3d · Nov 1 (Sun) · BLS · Kevin · Home Base
  ('40000000-0000-0000-0000-00000000003d',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-00000000d001',
   '2026-11-01 10:00:00-05', '2026-11-01 14:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x3e · Nov 5 (Thu) · Heartsaver CPR AED · Derek · Raymond James
  ('40000000-0000-0000-0000-00000000003e',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000019',
   '00000000-0000-0000-0000-00000000d005',
   '2026-11-05 09:00:00-05', '2026-11-05 12:00:00-05',
   8, 'scheduled', 'approved', false, false, 'Stadium pre-season event staff training.'),

  -- 0x3f · Nov 8 (Sun) · Pediatric FA CPR AED · Renee · Home Base — pending
  ('40000000-0000-0000-0000-00000000003f',
   '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-00000000001a',
   '00000000-0000-0000-0000-00000000d001',
   '2026-11-08 10:00:00-05', '2026-11-08 13:30:00-05',
   6, 'scheduled', 'pending_approval', false, false, null),

  -- 0x40 · Nov 12 (Thu) · BLS · Sarah · St. Joseph's
  ('40000000-0000-0000-0000-000000000040',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d004',
   '2026-11-12 09:00:00-05', '2026-11-12 13:00:00-05',
   8, 'scheduled', 'approved', false, false, 'St. Joseph''s nursing floor recert.'),

  -- 0x41 · Nov 15 (Sun) · First Aid CPR AED · Omar · Home Base
  ('40000000-0000-0000-0000-000000000041',
   '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-00000000001b',
   '00000000-0000-0000-0000-00000000d001',
   '2026-11-15 10:00:00-05', '2026-11-15 13:00:00-05',
   6, 'scheduled', 'approved', false, false, null),

  -- 0x42 · Nov 19 (Thu) · BLS · Cynthia · Tampa General
  ('40000000-0000-0000-0000-000000000042',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000018',
   '00000000-0000-0000-0000-00000000d002',
   '2026-11-19 09:00:00-05', '2026-11-19 13:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x43 · Nov 22 (Sun) · Heartsaver CPR AED · Brandon · Home Base
  ('40000000-0000-0000-0000-000000000043',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000017',
   '00000000-0000-0000-0000-00000000d001',
   '2026-11-22 10:00:00-05', '2026-11-22 13:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

-- ─── DECEMBER 2026 ───────────────────────────────────────────────────────────

  -- 0x44 · Dec 3 (Thu) · BLS · Jordan · Home Base
  ('40000000-0000-0000-0000-000000000044',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000015',
   '00000000-0000-0000-0000-00000000d001',
   '2026-12-03 09:00:00-05', '2026-12-03 13:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x45 · Dec 6 (Sun) · Heartsaver CPR AED · Sarah · Home Base
  ('40000000-0000-0000-0000-000000000045',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d001',
   '2026-12-06 10:00:00-05', '2026-12-06 13:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x46 · Dec 10 (Thu) · First Aid CPR AED · Tasha · Tampa General — pending
  ('40000000-0000-0000-0000-000000000046',
   '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000016',
   '00000000-0000-0000-0000-00000000d002',
   '2026-12-10 09:00:00-05', '2026-12-10 12:00:00-05',
   6, 'scheduled', 'pending_approval', false, false, null),

  -- 0x47 · Dec 13 (Sun) · BLS · Kevin · Home Base
  ('40000000-0000-0000-0000-000000000047',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-00000000d001',
   '2026-12-13 10:00:00-05', '2026-12-13 14:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x48 · Dec 17 (Thu) · Pediatric FA CPR AED · Mei-Ling · Home Base
  ('40000000-0000-0000-0000-000000000048',
   '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-000000000014',
   '00000000-0000-0000-0000-00000000d001',
   '2026-12-17 09:00:00-05', '2026-12-17 12:30:00-05',
   6, 'scheduled', 'approved', false, false, 'Holiday gift — pediatric CPR for new parents.'),

  -- 0x49 · Dec 20 (Sun) · BLS · Derek · HCFR Station 1
  ('40000000-0000-0000-0000-000000000049',
   '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000019',
   '00000000-0000-0000-0000-00000000d003',
   '2026-12-20 10:00:00-05', '2026-12-20 14:00:00-05',
   8, 'scheduled', 'approved', false, false, null),

  -- 0x4a · Dec 27 (Sun) · Heartsaver CPR AED · Sarah · Home Base
  ('40000000-0000-0000-0000-00000000004a',
   '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-00000000d001',
   '2026-12-27 10:00:00-05', '2026-12-27 13:00:00-05',
   8, 'scheduled', 'approved', false, false, 'Year-end open enrollment.')

on conflict (id) do nothing;

-- =============================================================================
-- BOOKINGS — 2–5 per session, deterministic customer assignment
--
-- session_seq continues from 28 (the last session in seed-staging.sql).
-- Formula: cust_idx = ((session_seq * 7) + (slot * 11)) % 100 + 1
-- Booking source: 'invoice' for every 7th slot, 'online' otherwise.
-- =============================================================================

do $$
declare
  new_session_ids uuid[] := array[
    '40000000-0000-0000-0000-000000000029'::uuid,
    '40000000-0000-0000-0000-00000000002a'::uuid,
    '40000000-0000-0000-0000-00000000002b'::uuid,
    '40000000-0000-0000-0000-00000000002c'::uuid,
    '40000000-0000-0000-0000-00000000002d'::uuid,
    '40000000-0000-0000-0000-00000000002e'::uuid,
    '40000000-0000-0000-0000-00000000002f'::uuid,
    '40000000-0000-0000-0000-000000000030'::uuid,
    '40000000-0000-0000-0000-000000000031'::uuid,
    '40000000-0000-0000-0000-000000000032'::uuid,
    '40000000-0000-0000-0000-000000000033'::uuid,
    '40000000-0000-0000-0000-000000000034'::uuid,
    '40000000-0000-0000-0000-000000000035'::uuid,
    '40000000-0000-0000-0000-000000000036'::uuid,
    '40000000-0000-0000-0000-000000000037'::uuid,
    '40000000-0000-0000-0000-000000000038'::uuid,
    '40000000-0000-0000-0000-000000000039'::uuid,
    '40000000-0000-0000-0000-00000000003a'::uuid,
    '40000000-0000-0000-0000-00000000003b'::uuid,
    '40000000-0000-0000-0000-00000000003c'::uuid,
    '40000000-0000-0000-0000-00000000003d'::uuid,
    '40000000-0000-0000-0000-00000000003e'::uuid,
    '40000000-0000-0000-0000-00000000003f'::uuid,
    '40000000-0000-0000-0000-000000000040'::uuid,
    '40000000-0000-0000-0000-000000000041'::uuid,
    '40000000-0000-0000-0000-000000000042'::uuid,
    '40000000-0000-0000-0000-000000000043'::uuid,
    '40000000-0000-0000-0000-000000000044'::uuid,
    '40000000-0000-0000-0000-000000000045'::uuid,
    '40000000-0000-0000-0000-000000000046'::uuid,
    '40000000-0000-0000-0000-000000000047'::uuid,
    '40000000-0000-0000-0000-000000000048'::uuid,
    '40000000-0000-0000-0000-000000000049'::uuid,
    '40000000-0000-0000-0000-00000000004a'::uuid
  ];
  s_id         uuid;
  session_seq  int;
  slot         int;
  fill         int;
  cust_idx     int;
  cust_id      uuid;
  src          booking_source;
  book_at      timestamptz;
  sess         record;
begin
  for i in 1..array_length(new_session_ids, 1) loop
    s_id := new_session_ids[i];
    session_seq := 28 + i;  -- continues from seed-staging.sql's 28 sessions

    select starts_at, approval_status
    into sess
    from class_sessions
    where id = s_id;

    -- Skip if session doesn't exist yet (re-run safety)
    if sess.starts_at is null then continue; end if;

    -- Only add bookings to approved sessions
    if sess.approval_status <> 'approved' then continue; end if;

    fill := 2 + (session_seq % 4);  -- 2, 3, 4, or 5 bookings

    -- Spread booking dates across 3–21 days before class
    book_at := sess.starts_at - ((7 + (session_seq % 14)) || ' days')::interval;

    for slot in 1..fill loop
      cust_idx := ((session_seq * 7) + (slot * 11)) % 100 + 1;
      cust_id  := ('30000000-0000-0000-0000-00000000' || lpad(to_hex(cust_idx), 4, '0'))::uuid;

      src := case when (slot % 7) = 0 then 'invoice'::booking_source
                  else 'online'::booking_source end;

      insert into bookings (id, session_id, customer_id, booking_source, created_at, updated_at)
      values (extensions.gen_random_uuid(), s_id, cust_id, src, book_at, book_at)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- =============================================================================
-- PAYMENTS — completed online payments for the new bookings
-- (payment is captured at time of online booking)
-- =============================================================================

insert into payments (
  id, customer_id, booking_id, logged_by,
  amount, status, payment_type, paypal_transaction_id, routing_note, notes,
  created_at
)
select
  extensions.gen_random_uuid(),
  b.customer_id,
  b.id,
  null,
  ct.price,
  'completed'::payment_status,
  'online'::payment_type,
  'PAYPAL-TXN-' || upper(substr(md5(b.id::text), 1, 12)),
  'Collected by SuperHeroCPR business PayPal — instructor payout pending',
  null,
  b.created_at + interval '1 hour'
from bookings b
join class_sessions cs on cs.id = b.session_id
join class_types    ct on ct.id = cs.class_type_id
where b.session_id = any(array[
    '40000000-0000-0000-0000-000000000029'::uuid,
    '40000000-0000-0000-0000-00000000002a'::uuid,
    '40000000-0000-0000-0000-00000000002b'::uuid,
    '40000000-0000-0000-0000-00000000002c'::uuid,
    '40000000-0000-0000-0000-00000000002d'::uuid,
    '40000000-0000-0000-0000-00000000002e'::uuid,
    '40000000-0000-0000-0000-00000000002f'::uuid,
    '40000000-0000-0000-0000-000000000030'::uuid,
    '40000000-0000-0000-0000-000000000031'::uuid,
    '40000000-0000-0000-0000-000000000032'::uuid,
    '40000000-0000-0000-0000-000000000033'::uuid,
    '40000000-0000-0000-0000-000000000034'::uuid,
    '40000000-0000-0000-0000-000000000035'::uuid,
    '40000000-0000-0000-0000-000000000036'::uuid,
    '40000000-0000-0000-0000-000000000037'::uuid,
    '40000000-0000-0000-0000-000000000038'::uuid,
    '40000000-0000-0000-0000-000000000039'::uuid,
    '40000000-0000-0000-0000-00000000003a'::uuid,
    '40000000-0000-0000-0000-00000000003b'::uuid,
    '40000000-0000-0000-0000-00000000003c'::uuid,
    '40000000-0000-0000-0000-00000000003d'::uuid,
    '40000000-0000-0000-0000-00000000003e'::uuid,
    '40000000-0000-0000-0000-00000000003f'::uuid,
    '40000000-0000-0000-0000-000000000040'::uuid,
    '40000000-0000-0000-0000-000000000041'::uuid,
    '40000000-0000-0000-0000-000000000042'::uuid,
    '40000000-0000-0000-0000-000000000043'::uuid,
    '40000000-0000-0000-0000-000000000044'::uuid,
    '40000000-0000-0000-0000-000000000045'::uuid,
    '40000000-0000-0000-0000-000000000046'::uuid,
    '40000000-0000-0000-0000-000000000047'::uuid,
    '40000000-0000-0000-0000-000000000048'::uuid,
    '40000000-0000-0000-0000-000000000049'::uuid,
    '40000000-0000-0000-0000-00000000004a'::uuid
  ])
  and b.booking_source = 'online'
  and b.cancelled = false
  and not exists (
    select 1 from payments p where p.booking_id = b.id
  );

-- =============================================================================
-- INSTRUCTOR EARNINGS — pending payout for the online payments above
-- SuperHeroCPR keeps 20%; instructor receives 80%.
-- =============================================================================

insert into instructor_earnings (
  instructor_id, source_type, booking_id, payment_id,
  gross_amount, platform_fee_percent, platform_fee_amount, instructor_amount,
  status, notes
)
select
  cs.instructor_id,
  'booking',
  b.id,
  p.id,
  p.amount,
  20,
  round((p.amount * 0.20)::numeric, 2),
  round((p.amount * 0.80)::numeric, 2),
  'pending',
  'Extended mock sessions 2026'
from payments p
join bookings       b  on b.id  = p.booking_id
join class_sessions cs on cs.id = b.session_id
where p.payment_type = 'online'
  and p.status       = 'completed'
  and cs.id = any(array[
    '40000000-0000-0000-0000-000000000029'::uuid,
    '40000000-0000-0000-0000-00000000002a'::uuid,
    '40000000-0000-0000-0000-00000000002b'::uuid,
    '40000000-0000-0000-0000-00000000002c'::uuid,
    '40000000-0000-0000-0000-00000000002d'::uuid,
    '40000000-0000-0000-0000-00000000002e'::uuid,
    '40000000-0000-0000-0000-00000000002f'::uuid,
    '40000000-0000-0000-0000-000000000030'::uuid,
    '40000000-0000-0000-0000-000000000031'::uuid,
    '40000000-0000-0000-0000-000000000032'::uuid,
    '40000000-0000-0000-0000-000000000033'::uuid,
    '40000000-0000-0000-0000-000000000034'::uuid,
    '40000000-0000-0000-0000-000000000035'::uuid,
    '40000000-0000-0000-0000-000000000036'::uuid,
    '40000000-0000-0000-0000-000000000037'::uuid,
    '40000000-0000-0000-0000-000000000038'::uuid,
    '40000000-0000-0000-0000-000000000039'::uuid,
    '40000000-0000-0000-0000-00000000003a'::uuid,
    '40000000-0000-0000-0000-00000000003b'::uuid,
    '40000000-0000-0000-0000-00000000003c'::uuid,
    '40000000-0000-0000-0000-00000000003d'::uuid,
    '40000000-0000-0000-0000-00000000003e'::uuid,
    '40000000-0000-0000-0000-00000000003f'::uuid,
    '40000000-0000-0000-0000-000000000040'::uuid,
    '40000000-0000-0000-0000-000000000041'::uuid,
    '40000000-0000-0000-0000-000000000042'::uuid,
    '40000000-0000-0000-0000-000000000043'::uuid,
    '40000000-0000-0000-0000-000000000044'::uuid,
    '40000000-0000-0000-0000-000000000045'::uuid,
    '40000000-0000-0000-0000-000000000046'::uuid,
    '40000000-0000-0000-0000-000000000047'::uuid,
    '40000000-0000-0000-0000-000000000048'::uuid,
    '40000000-0000-0000-0000-000000000049'::uuid,
    '40000000-0000-0000-0000-00000000004a'::uuid
  ])
on conflict do nothing;

-- =============================================================================
-- DONE
-- =============================================================================
do $$
declare
  new_session_count int;
  new_booking_count int;
  new_payment_count int;
begin
  select count(*) into new_session_count
  from class_sessions
  where id >= '40000000-0000-0000-0000-000000000029'
    and id <= '40000000-0000-0000-0000-00000000004a';

  select count(*) into new_booking_count
  from bookings b
  where b.session_id >= '40000000-0000-0000-0000-000000000029'
    and b.session_id <= '40000000-0000-0000-0000-00000000004a';

  select count(*) into new_payment_count
  from payments p
  join bookings b on b.id = p.booking_id
  where b.session_id >= '40000000-0000-0000-0000-000000000029'
    and b.session_id <= '40000000-0000-0000-0000-00000000004a';

  raise notice 'Extended mock sessions loaded:';
  raise notice '  Sessions (0x29–0x4a):  %', new_session_count;
  raise notice '  Bookings:              %', new_booking_count;
  raise notice '  Payments:              %', new_payment_count;
  raise notice 'Date range: 2026-08-20 through 2026-12-27';
end $$;
