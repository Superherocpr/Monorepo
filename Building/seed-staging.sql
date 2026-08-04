-- =============================================================================
-- Superhero CPR — Full Seed Data (STAGING ONLY)
-- =============================================================================
-- ⚠️  STAGING ONLY. DO NOT RUN AGAINST PRODUCTION. ⚠️
--
-- Run AFTER:
--   1. schema.sql              (tables exist)
--   2. seed-wipe-staging.sql   (database is clean, super_admins preserved)
--
-- All passwords: TestPass123!
--
-- Idempotent — uses fixed UUIDs everywhere. Re-running on a wiped DB yields
-- identical IDs. Re-running on a populated DB will fail at the first conflict.
-- Always run seed-wipe-staging.sql first.
--
-- KEY LOGIN ACCOUNTS:
--   Super admin:  danny@superherocpr.com         / TestPass123!
--   Manager:      lisa@superherocpr.com          / TestPass123!
--   Manager:      marcus@superherocpr.com        / TestPass123!
--   Manager:      patricia@superherocpr.com      / TestPass123!
--   Inspector:    tom@superherocpr.com           / TestPass123!
--   Inspector:    angela@superherocpr.com        / TestPass123!
--   Instructor:   sarah@superherocpr.com         / TestPass123!
--   Instructor:   kevin@superherocpr.com         / TestPass123!
--   Instructor:   brittany@superherocpr.com      / TestPass123!  (Square only)
--   Instructor:   darnell@superherocpr.com       / TestPass123!  (business routing)
--   Instructor:   meiling@superherocpr.com       / TestPass123!
--   Instructor:   jordan@superherocpr.com        / TestPass123!  (Stripe only)
--   Instructor:   tasha@superherocpr.com         / TestPass123!
--   Instructor:   brandon@superherocpr.com       / TestPass123!
--   Instructor:   cynthia@superherocpr.com       / TestPass123!  (Venmo Business)
--   Instructor:   derek@superherocpr.com         / TestPass123!
--   Instructor:   renee@superherocpr.com         / TestPass123!
--   Instructor:   omar@superherocpr.com          / TestPass123!
--   Instructor:   vanessa@superherocpr.com       / TestPass123!  (PayPal inactive)
--   Instructor:   james.ford@superherocpr.com    /  --DEACTIVATED--
--   Customers:    james.smith1@test.superherocpr.local … (100 accounts)
-- =============================================================================

set search_path to public, extensions;

-- ── Safety check ─────────────────────────────────────────────────────────────
do $$
declare
  non_admin_count int;
begin
  select count(*) into non_admin_count from profiles where role <> 'super_admin';
  if non_admin_count > 0 then
    raise exception
      'Refusing to seed: % non-super-admin profile(s) already exist. '
      'Run seed-wipe-staging.sql first.', non_admin_count;
  end if;
end $$;

-- =============================================================================
-- HELPER — auth user creation
-- =============================================================================
create or replace function _seed_create_auth_user(
  user_id uuid,
  user_email text,
  user_password text default 'TestPass123!'
) returns void
language plpgsql
as $fn$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    user_id, 'authenticated', 'authenticated', user_email,
    extensions.crypt(user_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(), user_id, user_id::text,
    jsonb_build_object('sub', user_id::text, 'email', user_email),
    'email', now(), now(), now()
  );
end $fn$;

-- =============================================================================
-- REFERENCE DATA
-- =============================================================================
insert into preset_grades (id, value, label) values
  ('00000000-0000-0000-0000-00000000a001', 100, 'Pass — Perfect'),
  ('00000000-0000-0000-0000-00000000a002',  85, 'Pass'),
  ('00000000-0000-0000-0000-00000000a003',  80, 'Pass'),
  ('00000000-0000-0000-0000-00000000a004',  75, 'Pass'),
  ('00000000-0000-0000-0000-00000000a005',  70, 'Pass — Minimum'),
  ('00000000-0000-0000-0000-00000000a006',   0, 'Fail');

insert into cert_types (id, name, description, validity_months, issuing_body, active) values
  ('00000000-0000-0000-0000-00000000c001', 'Heartsaver® First Aid eCard',
   'AHA Heartsaver First Aid certification. Covers adult/child/infant first aid, emergency action steps, and injury response.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c002', 'Heartsaver® CPR AED eCard',
   'AHA Heartsaver CPR and AED certification. Covers adult/child/infant CPR, AED use, and choking relief.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c003', 'Heartsaver® First Aid CPR AED eCard',
   'AHA Heartsaver combined First Aid, CPR, and AED certification for workplace and community responders.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c004', 'Heartsaver® Pediatric First Aid CPR AED eCard',
   'AHA Heartsaver pediatric certification for childcare providers, parents, and school staff.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c005', 'Heartsaver® for K-12 Schools eCard',
   'AHA Heartsaver certification for school faculty and staff.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c006', 'BLS Provider eCard',
   'AHA Basic Life Support certification for healthcare providers.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c007', 'ACLS Provider eCard',
   'AHA Advanced Cardiovascular Life Support certification for healthcare providers.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c008', 'PALS Provider eCard',
   'AHA Pediatric Advanced Life Support certification for healthcare providers.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c009', 'Heartsaver® Instructor eCard',
   'AHA authorization to teach Heartsaver CPR, AED, and First Aid courses.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c010', 'BLS Instructor eCard',
   'AHA authorization to teach BLS Provider courses in healthcare settings.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c011', 'ACLS Instructor eCard',
   'AHA authorization to teach Advanced Cardiovascular Life Support courses.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c012', 'PALS Instructor eCard',
   'AHA authorization to teach Pediatric Advanced Life Support courses.',
   24, 'American Heart Association', true),
  ('00000000-0000-0000-0000-00000000c013', 'Advisor: BLS eCard',
   'AHA BLS Training Site Faculty/Advisor designation.',
   24, 'American Heart Association', true);

insert into class_types (id, name, description, duration_minutes, max_capacity, price, active, cert_type_id) values
  -- The 4 original active courses, renamed to official AHA names, linked to cert types
  ('00000000-0000-0000-0000-00000000b001', 'BLS Provider',
   'AHA-certified Basic Life Support for healthcare providers. Covers high-quality CPR for adults, children, and infants, AED use, and team resuscitation dynamics.',
   240, 12, 65.00, true,  '00000000-0000-0000-0000-00000000c006'),
  ('00000000-0000-0000-0000-00000000b002', 'Heartsaver® CPR AED',
   'AHA-certified CPR and AED training for the general public and workplace responders. Covers adult, child, and infant CPR and AED use.',
   180, 16, 55.00, true,  '00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-00000000b003', 'Heartsaver® First Aid CPR AED',
   'AHA-certified combined First Aid, CPR, and AED course for the general public and workplace settings.',
   180, 16, 55.00, true,  '00000000-0000-0000-0000-00000000c003'),
  ('00000000-0000-0000-0000-00000000b004', 'Heartsaver® Pediatric First Aid CPR AED',
   'AHA-certified pediatric course for childcare providers, parents, and school staff. Covers infant and child CPR, AED use, choking relief, and pediatric first aid.',
   210, 14, 60.00, true,  '00000000-0000-0000-0000-00000000c004'),
  ('00000000-0000-0000-0000-00000000b005', 'Heartsaver® First Aid',
   'AHA-certified standalone First Aid course. Covers emergency action steps, bleeding control, burns, and medical emergencies.',
   90, 10, 45.00, false, '00000000-0000-0000-0000-00000000c001'),
  -- Remaining 8 AHA class types (inactive — prices/durations are placeholders)
  ('00000000-0000-0000-0000-00000000b006', 'Heartsaver® for K-12 Schools',
   'AHA-certified CPR and First Aid course designed for school faculty and staff.',
   180, 16, 55.00, false, '00000000-0000-0000-0000-00000000c005'),
  ('00000000-0000-0000-0000-00000000b007', 'ACLS Provider',
   'AHA Advanced Cardiovascular Life Support for healthcare providers.',
   480, 12, 150.00, false, '00000000-0000-0000-0000-00000000c007'),
  ('00000000-0000-0000-0000-00000000b008', 'PALS Provider',
   'AHA Pediatric Advanced Life Support for healthcare providers.',
   480, 12, 150.00, false, '00000000-0000-0000-0000-00000000c008'),
  ('00000000-0000-0000-0000-00000000b009', 'Heartsaver® Instructor',
   'AHA course that trains and certifies Heartsaver-level instructors.',
   480, 12, 200.00, false, '00000000-0000-0000-0000-00000000c009'),
  ('00000000-0000-0000-0000-00000000b010', 'BLS Instructor',
   'AHA course that trains and certifies BLS Provider instructors.',
   480, 12, 200.00, false, '00000000-0000-0000-0000-00000000c010'),
  ('00000000-0000-0000-0000-00000000b011', 'ACLS Instructor',
   'AHA course that trains and certifies ACLS instructors.',
   480, 12, 300.00, false, '00000000-0000-0000-0000-00000000c011'),
  ('00000000-0000-0000-0000-00000000b012', 'PALS Instructor',
   'AHA course that trains and certifies PALS instructors.',
   480, 12, 300.00, false, '00000000-0000-0000-0000-00000000c012'),
  ('00000000-0000-0000-0000-00000000b013', 'Advisor: BLS',
   'AHA BLS Training Site Faculty course for experienced instructors.',
   240, 12, 100.00, false, '00000000-0000-0000-0000-00000000c013');

insert into locations (id, name, address, city, state, zip, notes, is_home_base) values
  ('00000000-0000-0000-0000-00000000d001', 'Home Base', '4321 N Himes Ave', 'Tampa', 'FL', '33614',
   'Main training facility. Free parking on-site.', true),
  ('00000000-0000-0000-0000-00000000d002', 'Tampa General Hospital', '1 Tampa General Circle', 'Tampa', 'FL', '33606',
   'Visitor parking available. Check in at main security desk. Ask for CPR Training.', false),
  ('00000000-0000-0000-0000-00000000d003', 'Hillsborough County Fire Station 1', '808 E Zack St', 'Tampa', 'FL', '33602',
   'Ring the bell at the side door. Ask for the training coordinator.', false),
  ('00000000-0000-0000-0000-00000000d004', 'St. Joseph''s Hospital', '3001 W Dr Martin Luther King Jr Blvd', 'Tampa', 'FL', '33607',
   'Training room is on the 2nd floor, Room 214. Bring your employee badge.', false),
  ('00000000-0000-0000-0000-00000000d005', 'Raymond James Stadium', '4201 N Dale Mabry Hwy', 'Tampa', 'FL', '33607',
   'Corporate training entrance is Gate C. Parking validated. Contact events coordinator on arrival.', false);

-- =============================================================================
-- STAFF
-- =============================================================================
do $$
declare
  danny_id uuid := '10000000-0000-0000-0000-000000000001';
  existing_danny uuid;
begin
  select id into existing_danny from profiles where lower(email) = 'danny@superherocpr.com';
  if existing_danny is not null then
    danny_id := existing_danny;
  else
    perform _seed_create_auth_user(danny_id, 'danny@superherocpr.com');
    insert into profiles (
      id, first_name, last_name, email, phone, address, city, state, zip,
      role, is_lead_instructor, daily_access_code, paypal_payout_email
    ) values (
      danny_id, 'Danny', 'Hernandez', 'danny@superherocpr.com',
      '813-555-0101', '4321 N Himes Ave', 'Tampa', 'FL', '33614',
      'super_admin', true, '123456', 'danny@superherocpr.com'
    );
  end if;
  perform set_config('seed.danny_id', danny_id::text, false);
end $$;

-- Managers
select _seed_create_auth_user('10000000-0000-0000-0000-000000000002', 'lisa@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, address, city, state, zip, role) values
  ('10000000-0000-0000-0000-000000000002', 'Lisa', 'Chen', 'lisa@superherocpr.com', '813-555-0102', '2200 W Kennedy Blvd', 'Tampa', 'FL', '33606', 'manager');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000003', 'marcus@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, address, city, state, zip, role) values
  ('10000000-0000-0000-0000-000000000003', 'Marcus', 'Webb', 'marcus@superherocpr.com', '813-555-0103', '510 S Howard Ave', 'Tampa', 'FL', '33606', 'manager');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000004', 'patricia@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, address, city, state, zip, role) values
  ('10000000-0000-0000-0000-000000000004', 'Patricia', 'Gomez', 'patricia@superherocpr.com', '813-555-0104', '3401 Bayshore Blvd', 'Tampa', 'FL', '33629', 'manager');

-- Inspectors
select _seed_create_auth_user('10000000-0000-0000-0000-000000000005', 'tom@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role) values
  ('10000000-0000-0000-0000-000000000005', 'Tom', 'Bradley', 'tom@superherocpr.com', '813-555-0105', 'inspector');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000006', 'angela@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role) values
  ('10000000-0000-0000-0000-000000000006', 'Angela', 'Ross', 'angela@superherocpr.com', '813-555-0106', 'inspector');

-- Instructors
select _seed_create_auth_user('10000000-0000-0000-0000-000000000010', 'sarah@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, address, city, state, zip, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000010', 'Sarah', 'Martinez', 'sarah@superherocpr.com', '813-555-0110', '120 W Whiting St', 'Tampa', 'FL', '33602', 'instructor', '234567', 'sarah@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000011', 'kevin@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000011', 'Kevin', 'Okafor', 'kevin@superherocpr.com', '813-555-0111', 'instructor', '345678', 'kevin@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000012', 'brittany@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000012', 'Brittany', 'Hall', 'brittany@superherocpr.com', '813-555-0112', 'instructor', '456789', 'brittany@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000013', 'darnell@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000013', 'Darnell', 'Washington', 'darnell@superherocpr.com', '813-555-0113', 'instructor', '345679', null);
select _seed_create_auth_user('10000000-0000-0000-0000-000000000014', 'meiling@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000014', 'Mei-Ling', 'Torres', 'meiling@superherocpr.com', '813-555-0114', 'instructor', '567890', 'meiling@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000015', 'jordan@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000015', 'Jordan', 'Price', 'jordan@superherocpr.com', '813-555-0115', 'instructor', '678901', 'jordan@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000016', 'tasha@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000016', 'Tasha', 'Nguyen', 'tasha@superherocpr.com', '813-555-0116', 'instructor', '789012', 'tasha@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000017', 'brandon@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000017', 'Brandon', 'Ellis', 'brandon@superherocpr.com', '813-555-0117', 'instructor', '890123', 'brandon@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000018', 'cynthia@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000018', 'Cynthia', 'Park', 'cynthia@superherocpr.com', '813-555-0118', 'instructor', '901234', 'cynthia@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-000000000019', 'derek@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-000000000019', 'Derek', 'Simmons', 'derek@superherocpr.com', '813-555-0119', 'instructor', '012345', 'derek@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-00000000001a', 'renee@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-00000000001a', 'Renee', 'Foster', 'renee@superherocpr.com', '813-555-0120', 'instructor', '135790', 'renee@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-00000000001b', 'omar@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-00000000001b', 'Omar', 'Castillo', 'omar@superherocpr.com', '813-555-0121', 'instructor', '246801', 'omar@superherocpr.com');
select _seed_create_auth_user('10000000-0000-0000-0000-00000000001c', 'vanessa@superherocpr.com');
insert into profiles (id, first_name, last_name, email, phone, role, daily_access_code, paypal_payout_email) values
  ('10000000-0000-0000-0000-00000000001c', 'Vanessa', 'Burke', 'vanessa@superherocpr.com', '813-555-0122', 'instructor', '357912', 'vanessa@superherocpr.com');

select _seed_create_auth_user('10000000-0000-0000-0000-00000000001d', 'james.ford@superherocpr.com');
-- deactivated_at not yet in live DB — omitted until schema migration applies it.
insert into profiles (id, first_name, last_name, email, phone, role, deactivated, paypal_payout_email) values
  ('10000000-0000-0000-0000-00000000001d', 'James', 'Ford', 'james.ford@superherocpr.com', '813-555-0123', 'instructor', true, 'james.ford@superherocpr.com');
update auth.users set banned_until = now() + interval '100 years' where id = '10000000-0000-0000-0000-00000000001d';

-- =============================================================================
-- CUSTOMERS — 100 accounts
-- =============================================================================
do $$
declare
  first_names text[] := array[
    'James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','William','Elizabeth',
    'David','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen',
    'Christopher','Nancy','Daniel','Lisa','Matthew','Margaret','Anthony','Betty','Donald','Sandra',
    'Mark','Ashley','Paul','Kimberly','Steven','Emily','Andrew','Donna','Kenneth','Michelle',
    'Joshua','Carol','Kevin','Amanda','Brian','Melissa','George','Deborah','Edward','Stephanie',
    'Ronald','Rebecca','Timothy','Laura','Jason','Sharon','Jeffrey','Cynthia','Ryan','Kathleen',
    'Jacob','Amy','Gary','Shirley','Nicholas','Angela','Eric','Helen','Jonathan','Anna',
    'Stephen','Brenda','Larry','Pamela','Justin','Nicole','Scott','Samantha','Brandon','Katherine',
    'Benjamin','Christine','Samuel','Debra','Gregory','Rachel','Alexander','Catherine','Patrick','Carolyn',
    'Frank','Janet','Raymond','Ruth','Jack','Maria','Dennis','Heather','Jerry','Diane'
  ];
  last_names text[] := array[
    'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
    'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
    'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
    'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
    'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts',
    'Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes',
    'Stewart','Morris','Morales','Murphy','Cook','Rogers','Gutierrez','Ortiz','Morgan','Cooper',
    'Peterson','Bailey','Reed','Kelly','Howard','Ramos','Kim','Cox','Ward','Richardson',
    'Watson','Brooks','Chavez','Wood','James','Bennett','Gray','Mendoza','Ruiz','Hughes',
    'Price','Alvarez','Castillo','Sanders','Patel','Myers','Long','Ross','Foster','Jimenez'
  ];
  i int;
  cust_id uuid;
  fname text;
  lname text;
  emaddr text;
  base_uuid text := '30000000-0000-0000-0000-00000000';    -- 8 zeros; appending lpad(to_hex(i),4,'0') yields a valid 12-char final segment
  signup_age_days int;
begin
  for i in 1..100 loop
    fname := first_names[i];
    lname := last_names[i];
    emaddr := lower(fname) || '.' || lower(lname) || i::text || '@test.superherocpr.local';
    cust_id := (base_uuid || lpad(to_hex(i), 4, '0'))::uuid;
    signup_age_days := (i * 5) % 540 + 1;

    perform _seed_create_auth_user(cust_id, emaddr);
    insert into profiles (id, first_name, last_name, email, phone, address, city, state, zip, role, created_at, updated_at) values (
      cust_id, fname, lname, emaddr,
      '813-555-' || lpad((1000 + i)::text, 4, '0'),
      (100 + i)::text || ' Main St', 'Tampa', 'FL', '33614', 'customer',
      now() - (signup_age_days || ' days')::interval,
      now() - (signup_age_days || ' days')::interval
    );
  end loop;
end $$;

update profiles set customer_notes = 'VIP corporate contact — handles bookings for Tampa General nursing staff.'
  where id = '30000000-0000-0000-0000-000000000007';
update profiles set customer_notes = 'Requested Spanish-language materials for next class.'
  where id = '30000000-0000-0000-0000-000000000019';
-- archived_at column not yet in live DB — set flag only for now.
update profiles set archived = true where id = '30000000-0000-0000-0000-000000000063';
update profiles set archived = true where id = '30000000-0000-0000-0000-000000000088';

-- =============================================================================
-- CLASS SESSIONS — 40 sessions
-- =============================================================================
insert into class_sessions (id, class_type_id, instructor_id, location_id, starts_at, ends_at, max_capacity, status, approval_status, roster_imported, enrollware_submitted, notes) values
  -- 20 PAST + COMPLETED + APPROVED
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000d001', now() - interval '500 days', now() - interval '500 days' + interval '3 hours', 8, 'completed', 'approved', true, true, 'Full house. Strong cohort.'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000d002', now() - interval '470 days', now() - interval '470 days' + interval '150 minutes', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000d001', now() - interval '440 days', now() - interval '440 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-00000000d004', now() - interval '410 days', now() - interval '410 days' + interval '3 hours', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-00000000d001', now() - interval '380 days', now() - interval '380 days' + interval '2 hours', 6, 'completed', 'approved', true, true, 'Parents-of-newborns cohort.'),
  ('40000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-00000000d003', now() - interval '350 days', now() - interval '350 days' + interval '3 hours', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-00000000d001', now() - interval '320 days', now() - interval '320 days' + interval '150 minutes', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-00000000d001', now() - interval '300 days', now() - interval '300 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-00000000d005', now() - interval '280 days', now() - interval '280 days' + interval '3 hours', 8, 'completed', 'approved', true, true, 'Stadium staff annual recert.'),
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000d001', now() - interval '260 days', now() - interval '260 days' + interval '150 minutes', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000d002', now() - interval '240 days', now() - interval '240 days' + interval '3 hours', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-00000000001c', '00000000-0000-0000-0000-00000000d001', now() - interval '220 days', now() - interval '220 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000b001', current_setting('seed.danny_id')::uuid, '00000000-0000-0000-0000-00000000d001', now() - interval '200 days', now() - interval '200 days' + interval '3 hours', 8, 'completed', 'approved', true, true, 'Danny taught — packed class.'),
  ('40000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000d004', now() - interval '180 days', now() - interval '180 days' + interval '150 minutes', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000d001', now() - interval '160 days', now() - interval '160 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-00000000d003', now() - interval '140 days', now() - interval '140 days' + interval '3 hours', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-00000000d001', now() - interval '120 days', now() - interval '120 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-00000000d002', now() - interval '100 days', now() - interval '100 days' + interval '3 hours', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-00000000d001', now() - interval '80 days', now() - interval '80 days' + interval '150 minutes', 8, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-00000000d005', now() - interval '60 days', now() - interval '60 days' + interval '3 hours', 8, 'completed', 'approved', true, true, 'Stadium event staff.'),
  -- 5 RECENT PAST awaiting approval/import
  ('40000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000d001', now() - interval '12 days', now() - interval '12 days' + interval '3 hours', 8, 'completed', 'pending_approval', true, false, 'Roster captured via rollcall, waiting on manager approval.'),
  ('40000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-00000000d001', now() - interval '8 days', now() - interval '8 days' + interval '150 minutes', 8, 'completed', 'pending_approval', true, false, null),
  ('40000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000d002', now() - interval '5 days', now() - interval '5 days' + interval '3 hours', 8, 'completed', 'approved', true, false, 'Approved, awaiting Enrollware submission.'),
  ('40000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000d001', now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 6, 'completed', 'approved', true, true, null),
  ('40000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-00000000d004', now() - interval '1 days', now() - interval '1 days' + interval '3 hours', 8, 'completed', 'pending_approval', true, false, null),
  -- 12 UPCOMING approved
  ('40000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000d001', now() + interval '3 days', now() + interval '3 days' + interval '3 hours', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000d001', now() + interval '5 days', now() + interval '5 days' + interval '150 minutes', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-00000000001c', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000d001', now() + interval '7 days', now() + interval '7 days' + interval '2 hours', 6, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-00000000001d', '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-00000000d001', now() + interval '10 days', now() + interval '10 days' + interval '2 hours', 6, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-00000000001e', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-00000000d002', now() + interval '12 days', now() + interval '12 days' + interval '3 hours', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-00000000001f', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-00000000d003', now() + interval '15 days', now() + interval '15 days' + interval '150 minutes', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-00000000d001', now() + interval '18 days', now() + interval '18 days' + interval '3 hours', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-00000000d005', now() + interval '22 days', now() + interval '22 days' + interval '3 hours', 8, 'scheduled', 'approved', false, false, 'Booked out by Raymond James staff.'),
  ('40000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000d001', now() + interval '26 days', now() + interval '26 days' + interval '150 minutes', 8, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-00000000b003', '10000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000d001', now() + interval '30 days', now() + interval '30 days' + interval '2 hours', 6, 'scheduled', 'approved', false, false, null),
  ('40000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-00000000b001', current_setting('seed.danny_id')::uuid, '00000000-0000-0000-0000-00000000d001', now() + interval '35 days', now() + interval '35 days' + interval '3 hours', 8, 'scheduled', 'approved', false, false, 'Danny teaching this one personally.'),
  ('40000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-00000000b004', '10000000-0000-0000-0000-00000000001c', '00000000-0000-0000-0000-00000000d001', now() + interval '40 days', now() + interval '40 days' + interval '2 hours', 6, 'scheduled', 'approved', false, false, null),
  -- 3 PENDING APPROVAL
  ('40000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-00000000d001', now() + interval '14 days', now() + interval '14 days' + interval '3 hours', 8, 'scheduled', 'pending_approval', false, false, 'Proposed by Cynthia. Conflicts with Brandon''s approved 18-day session at home base — manager review needed.'),
  ('40000000-0000-0000-0000-000000000027', '00000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-00000000d001', now() + interval '21 days', now() + interval '21 days' + interval '150 minutes', 8, 'scheduled', 'pending_approval', false, false, 'Proposed by Darnell. Awaiting confirmation of room availability.'),
  ('40000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-00000000d004', now() + interval '28 days', now() + interval '28 days' + interval '3 hours', 8, 'scheduled', 'pending_approval', false, false, null);

-- =============================================================================
-- INVOICES — 15 invoices (10 paid, 3 sent/unpaid, 2 cancelled)
-- =============================================================================
-- Tied to past completed sessions where applicable, plus a couple to upcoming.
insert into invoices (id, invoice_number, class_session_id, instructor_id, invoice_type, recipient_name, recipient_email, company_name, student_count, amount_per_student, custom_price, total_amount, payment_platform, platform_invoice_id, status, notes, paid_at, created_at) values
  ('50000000-0000-0000-0000-000000000001', 'INV-2024-0001', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000014', 'group', 'Tampa General HR', 'hr@tgh.example', 'Tampa General Hospital', 6, 60.00, true, 360.00, 'paypal', 'PAYPAL-INV-001', 'paid', 'Bulk discount applied for 6 students.', now() - interval '405 days', now() - interval '420 days'),
  ('50000000-0000-0000-0000-000000000002', 'INV-2024-0002', '40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000016', 'group', 'HCFR Training Coordinator', 'training@hcfr.example', 'Hillsborough County Fire Rescue', 8, 65.00, false, 520.00, 'paypal', 'PAYPAL-INV-002', 'paid', null, now() - interval '345 days', now() - interval '360 days'),
  ('50000000-0000-0000-0000-000000000003', 'INV-2024-0003', '40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000019', 'group', 'Buccaneers Stadium Ops', 'ops@raymondjames.example', 'Raymond James Stadium', 8, 65.00, false, 520.00, 'square', 'SQ-INV-003', 'paid', 'Annual recert for game-day medical staff.', now() - interval '275 days', now() - interval '290 days'),
  ('50000000-0000-0000-0000-000000000004', 'INV-2024-0004', '40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000001b', 'group', 'TGH Nursing Education', 'nursing.ed@tgh.example', 'Tampa General Hospital', 8, 55.00, true, 440.00, 'paypal', 'PAYPAL-INV-004', 'paid', null, now() - interval '235 days', now() - interval '250 days'),
  ('50000000-0000-0000-0000-000000000005', 'INV-2025-0001', '40000000-0000-0000-0000-00000000000d', current_setting('seed.danny_id')::uuid, 'individual', 'Patricia Gomez', 'patricia.gomez101@example.com', null, 1, 65.00, false, 65.00, 'paypal', 'PAYPAL-INV-005', 'paid', null, now() - interval '198 days', now() - interval '205 days'),
  ('50000000-0000-0000-0000-000000000006', 'INV-2025-0002', '40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000014', 'group', 'Station 1 Probationary Class', 'training@hcfr.example', 'Hillsborough County Fire Rescue', 6, 65.00, false, 390.00, 'square', 'SQ-INV-006', 'paid', null, now() - interval '135 days', now() - interval '150 days'),
  ('50000000-0000-0000-0000-000000000007', 'INV-2025-0003', '40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000016', 'group', 'TGH Day Surgery', 'daysurgery@tgh.example', 'Tampa General Hospital', 5, 65.00, true, 300.00, 'paypal', 'PAYPAL-INV-007', 'paid', '5-student discount.', now() - interval '95 days', now() - interval '110 days'),
  ('50000000-0000-0000-0000-000000000008', 'INV-2025-0004', '40000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000019', 'group', 'Stadium Game-Day Medics', 'ops@raymondjames.example', 'Raymond James Stadium', 8, 65.00, false, 520.00, 'square', 'SQ-INV-008', 'paid', null, now() - interval '55 days', now() - interval '70 days'),
  ('50000000-0000-0000-0000-000000000009', 'INV-2025-0005', '40000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-00000000001b', 'group', 'TGH Cardiology Unit', 'cardiology@tgh.example', 'Tampa General Hospital', 8, 65.00, false, 520.00, 'paypal', 'PAYPAL-INV-009', 'paid', null, now() - interval '4 days', now() - interval '10 days'),
  ('50000000-0000-0000-0000-00000000000a', 'INV-2025-0006', '40000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000012', 'individual', 'Jennifer Johnson', 'jennifer.johnson6@example.com', null, 1, 50.00, false, 50.00, 'square', 'SQ-INV-010', 'paid', null, now() - interval '3 days', now() - interval '5 days'),

  -- SENT (unpaid, awaiting payment)
  ('50000000-0000-0000-0000-00000000000b', 'INV-2025-0007', '40000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000019', 'group', 'Stadium Game-Day Medics', 'ops@raymondjames.example', 'Raymond James Stadium', 8, 65.00, false, 520.00, 'square', 'SQ-INV-011', 'sent', null, null, now() - interval '6 days'),
  ('50000000-0000-0000-0000-00000000000c', 'INV-2025-0008', '40000000-0000-0000-0000-00000000001e', '10000000-0000-0000-0000-000000000014', 'group', 'TGH ER Onboarding', 'er.training@tgh.example', 'Tampa General Hospital', 4, 65.00, false, 260.00, 'paypal', 'PAYPAL-INV-012', 'sent', null, null, now() - interval '3 days'),
  ('50000000-0000-0000-0000-00000000000d', 'INV-2025-0009', '40000000-0000-0000-0000-000000000024', current_setting('seed.danny_id')::uuid, 'individual', 'Mary Williams', 'mary.williams2@example.com', null, 1, 65.00, false, 65.00, 'paypal', 'PAYPAL-INV-013', 'sent', null, null, now() - interval '2 days'),

  -- CANCELLED
  ('50000000-0000-0000-0000-00000000000e', 'INV-2025-0010', '40000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000010', 'individual', 'Robert Brown', 'robert.brown3@example.com', null, 1, 55.00, false, 55.00, 'paypal', 'PAYPAL-INV-014', 'cancelled', 'Customer requested refund — booked wrong class type.', null, now() - interval '185 days'),
  ('50000000-0000-0000-0000-00000000000f', 'INV-2025-0011', '40000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000017', 'group', 'St. Joe''s Onboarding', 'onboarding@stjoes.example', 'St. Joseph''s Hospital', 8, 55.00, false, 440.00, 'paypal', 'PAYPAL-INV-015', 'cancelled', 'Class re-scheduled — invoice voided and re-issued under INV-2025-0005.', null, now() - interval '85 days');

update invoices set cancelled_at = now() - interval '180 days' where id = '50000000-0000-0000-0000-00000000000e';
update invoices set cancelled_at = now() - interval '82 days' where id = '50000000-0000-0000-0000-00000000000f';

-- Invoice activity log (one created + one paid event per paid invoice; cancelled gets a cancel event)
insert into invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
select i.id, i.instructor_id, 'created', 'Invoice generated and sent.', i.created_at from invoices i;
insert into invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
select i.id, i.instructor_id, 'paid', 'Payment received via ' || i.payment_platform::text || '.', i.paid_at from invoices i where i.status = 'paid';
insert into invoice_activity_log (invoice_id, actor_id, action, notes, created_at)
select i.id, i.instructor_id, 'cancelled', coalesce(i.notes, 'Invoice cancelled.'), i.cancelled_at from invoices i where i.status = 'cancelled';

-- =============================================================================
-- BOOKINGS — programmatic, for past completed + some upcoming sessions
-- =============================================================================
-- For each completed session, fill ~5–8 spots from the customer pool.
-- For each upcoming session, fill ~3–6 spots.
-- Customer assignment is deterministic so re-runs are identical: customer index
-- = ((session_seq * 7) + slot_seq * 11) mod 100, +1.

do $$
declare
  s record;
  slot int;
  fill int;
  cust_idx int;
  cust_id uuid;
  session_seq int := 0;
  is_upcoming boolean;
  src booking_source;
begin
  for s in
    select cs.id, cs.starts_at, cs.max_capacity, cs.status, cs.approval_status, cs.class_type_id
    from class_sessions cs
    order by cs.starts_at
  loop
    session_seq := session_seq + 1;
    is_upcoming := s.starts_at > now();

    if s.status = 'completed' then
      fill := least(s.max_capacity, 5 + (session_seq % 4));   -- 5..8
    elsif is_upcoming and s.approval_status = 'approved' then
      fill := least(s.max_capacity, 3 + (session_seq % 4));   -- 3..6
    else
      fill := 0;
    end if;

    for slot in 1..fill loop
      cust_idx := ((session_seq * 7) + (slot * 11)) % 100 + 1;
      cust_id  := ('30000000-0000-0000-0000-00000000' || lpad(to_hex(cust_idx), 4, '0'))::uuid;

      -- Vary the source: most online, some rollcall (for past), some invoice
      if s.status = 'completed' and (slot % 5) = 0 then
        src := 'rollcall';
      elsif (slot % 7) = 0 then
        src := 'invoice';
      else
        src := 'online';
      end if;

      insert into bookings (id, session_id, customer_id, booking_source, created_at, updated_at)
      values (
        extensions.gen_random_uuid(), s.id, cust_id, src,
        s.starts_at - interval '5 days', s.starts_at - interval '5 days'
      )
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- A few cancellations on past sessions for realism
update bookings set
  cancelled = true,
  cancellation_note = 'Customer cancelled — illness',
  cancelled_by = customer_id,
  updated_at = created_at + interval '2 days'
where ctid in (
  select ctid from bookings where cancelled = false order by created_at limit 8 offset 30
);

-- =============================================================================
-- ROSTER RECORDS — mirror confirmed bookings on completed sessions, with grades
-- =============================================================================
insert into roster_records (id, session_id, booking_id, first_name, last_name, email, phone, employer, grade, confirmed, corrected, created_at, updated_at)
select
  extensions.gen_random_uuid(),
  b.session_id,
  b.id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  case when (random() < 0.4) then 'Tampa General Hospital'
       when (random() < 0.7) then 'Hillsborough County Fire Rescue'
       else null end,
  case
    when (abs(hashtext(b.id::text)) % 20) = 0 then 0     -- 5% fail
    when (abs(hashtext(b.id::text)) % 5)  = 0 then 100   -- 20% perfect
    when (abs(hashtext(b.id::text)) % 5)  = 1 then 85
    when (abs(hashtext(b.id::text)) % 5)  = 2 then 80
    when (abs(hashtext(b.id::text)) % 5)  = 3 then 75
    else 70
  end,
  true,
  false,
  cs.starts_at,
  cs.starts_at + interval '1 hour'
from bookings b
join class_sessions cs on cs.id = b.session_id
join profiles p on p.id = b.customer_id
where cs.status = 'completed'
  and b.cancelled = false;

-- Push grades back onto bookings (so the dashboard "my certifications" view works)
update bookings b
set grade = r.grade
from roster_records r
where r.booking_id = b.id;

-- =============================================================================
-- CERTIFICATIONS — for passing roster_records (grade >= 70) on approved sessions
-- =============================================================================
insert into certifications (id, customer_id, cert_type_id, session_id, issued_at, expires_at, cert_number, reminder_sent, created_at)
select
  extensions.gen_random_uuid(),
  b.customer_id,
  case ct.name
    when 'BLS (Basic Life Support)' then '00000000-0000-0000-0000-00000000c001'::uuid
    when 'Heartsaver CPR/AED'       then '00000000-0000-0000-0000-00000000c002'::uuid
    when 'CPR + AED'                then '00000000-0000-0000-0000-00000000c003'::uuid
    when 'Pediatric CPR'            then '00000000-0000-0000-0000-00000000c004'::uuid
  end,
  cs.id,
  cs.starts_at::date,
  (cs.starts_at + interval '24 months')::date,
  'AHA-' || upper(substr(md5(b.id::text), 1, 10)),
  false,
  cs.starts_at + interval '2 days'
from bookings b
join class_sessions cs on cs.id = b.session_id
join class_types ct   on ct.id = cs.class_type_id
where cs.status = 'completed'
  and cs.approval_status = 'approved'
  and cs.enrollware_submitted = true
  and b.cancelled = false
  and coalesce(b.grade, 0) >= 70;

-- Mark reminder_sent=true on certs that expire within 60 days
update certifications
set reminder_sent = true
where expires_at <= (current_date + interval '60 days')::date;

-- =============================================================================
-- PAYMENTS — for online and invoice bookings
-- =============================================================================
insert into payments (id, customer_id, booking_id, logged_by, amount, status, payment_type, paypal_transaction_id, routing_note, notes, created_at)
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
join class_types ct   on ct.id = cs.class_type_id
where b.booking_source = 'online'
  and b.cancelled = false;

-- Cash & check payments for some rollcall walk-ins
insert into payments (id, customer_id, booking_id, logged_by, amount, status, payment_type, notes, created_at)
select
  extensions.gen_random_uuid(),
  b.customer_id,
  b.id,
  cs.instructor_id,
  ct.price,
  'completed'::payment_status,
  case when (abs(hashtext(b.id::text)) % 2) = 0 then 'cash'::payment_type else 'check'::payment_type end,
  'Logged at class by instructor.',
  cs.starts_at + interval '15 minutes'
from bookings b
join class_sessions cs on cs.id = b.session_id
join class_types ct   on ct.id = cs.class_type_id
where b.booking_source = 'rollcall'
  and b.cancelled = false;

-- Invoice-tied payments
insert into payments (id, customer_id, booking_id, logged_by, amount, status, payment_type, notes, created_at)
select
  extensions.gen_random_uuid(),
  b.customer_id,
  b.id,
  null,
  ct.price,
  'completed'::payment_status,
  'invoice'::payment_type,
  'Group invoice payment.',
  b.created_at + interval '2 days'
from bookings b
join class_sessions cs on cs.id = b.session_id
join class_types ct   on ct.id = cs.class_type_id
where b.booking_source = 'invoice'
  and b.cancelled = false;

-- Instructor earnings for payout dashboard testing. SuperHeroCPR keeps 20%.
insert into instructor_earnings (
  instructor_id, source_type, booking_id, payment_id, gross_amount,
  platform_fee_percent, platform_fee_amount, instructor_amount, status, notes
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
  'Seeded online booking earning'
from payments p
join bookings b on b.id = p.booking_id
join class_sessions cs on cs.id = b.session_id
where p.payment_type = 'online'
  and p.status = 'completed'
on conflict do nothing;

insert into instructor_earnings (
  instructor_id, source_type, invoice_id, gross_amount,
  platform_fee_percent, platform_fee_amount, instructor_amount, status, notes
)
select
  i.instructor_id,
  'invoice',
  i.id,
  i.total_amount,
  20,
  round((i.total_amount * 0.20)::numeric, 2),
  round((i.total_amount * 0.80)::numeric, 2),
  'pending',
  'Seeded paid invoice earning'
from invoices i
where i.status = 'paid'
on conflict do nothing;

-- =============================================================================
-- MERCH — products + variants + stock_adjustments + orders + order_items
-- =============================================================================
insert into products (id, name, description, price, image_url, active, low_stock_threshold) values
  ('60000000-0000-0000-0000-000000000001', 'Superhero CPR Logo Tee',
   'Classic black cotton tee with the Superhero CPR cape-and-heart logo on the chest.',
   24.99, 'https://placehold.co/400x400?text=Logo+Tee', true, 5),
  ('60000000-0000-0000-0000-000000000002', '"Save Lives" Hoodie',
   'Heavyweight pullover hoodie. Soft brushed interior. Front pocket. "Save Lives" embroidered on the back.',
   49.99, 'https://placehold.co/400x400?text=Hoodie', true, 3),
  ('60000000-0000-0000-0000-000000000003', 'CPR Pocket Mask',
   'Compact one-way valve CPR pocket mask in a hard plastic carrying case. Fits in a glove box or first-aid kit.',
   14.99, 'https://placehold.co/400x400?text=Pocket+Mask', true, 10),
  ('60000000-0000-0000-0000-000000000004', 'Instructor Polo',
   'Performance polo shirt for instructors. Embroidered Superhero CPR crest. Moisture-wicking fabric.',
   39.99, 'https://placehold.co/400x400?text=Polo', true, 4),
  ('60000000-0000-0000-0000-000000000005', 'Tampa Heroes Cap',
   'Limited-edition snapback cap. Tampa-skyline patch on the front. Discontinued — last stock.',
   22.99, 'https://placehold.co/400x400?text=Cap', false, 2);

insert into product_variants (id, product_id, size, stock_quantity) values
  -- Logo Tee: SM, MD, LG, XL
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'SM', 12),
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'MD', 18),
  ('61000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000001', 'LG', 22),
  ('61000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000001', 'XL',  4),  -- low stock
  -- Hoodie
  ('61000000-0000-0000-0000-000000000005', '60000000-0000-0000-0000-000000000002', 'SM',  6),
  ('61000000-0000-0000-0000-000000000006', '60000000-0000-0000-0000-000000000002', 'MD',  8),
  ('61000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000002', 'LG',  2),  -- low
  ('61000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000002', 'XL',  0),  -- out
  -- Pocket Mask (one size)
  ('61000000-0000-0000-0000-000000000009', '60000000-0000-0000-0000-000000000003', 'OS', 50),
  -- Polo
  ('61000000-0000-0000-0000-00000000000a', '60000000-0000-0000-0000-000000000004', 'SM',  5),
  ('61000000-0000-0000-0000-00000000000b', '60000000-0000-0000-0000-000000000004', 'MD',  9),
  ('61000000-0000-0000-0000-00000000000c', '60000000-0000-0000-0000-000000000004', 'LG',  7),
  ('61000000-0000-0000-0000-00000000000d', '60000000-0000-0000-0000-000000000004', 'XL',  3),  -- low
  -- Cap (discontinued, low)
  ('61000000-0000-0000-0000-00000000000e', '60000000-0000-0000-0000-000000000005', 'OS',  1);

-- A couple of stock adjustments for the audit log
insert into stock_adjustments (id, variant_id, adjusted_by, previous_quantity, new_quantity, notes, created_at) values
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000004', current_setting('seed.danny_id')::uuid, 8, 4, 'Inventory recount — found discrepancy.', now() - interval '20 days'),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000007', current_setting('seed.danny_id')::uuid, 6, 2, 'Damaged units removed.', now() - interval '10 days'),
  ('62000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000002', 5, 1, 'Final clearance — discontinued line.', now() - interval '4 days');

-- Orders
insert into orders (id, customer_id, status, total_amount, paypal_transaction_id, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, tracking_number, created_at, updated_at) values
  ('63000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'delivered', 49.98, 'PAYPAL-ORD-001', 'James Smith', '101 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456784', now() - interval '60 days', now() - interval '55 days'),
  ('63000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', 'delivered', 24.99, 'PAYPAL-ORD-002', 'John Jones', '105 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456785', now() - interval '50 days', now() - interval '46 days'),
  ('63000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-00000000000a', 'delivered', 64.98, 'PAYPAL-ORD-003', 'Elizabeth Martinez', '110 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456786', now() - interval '40 days', now() - interval '36 days'),
  ('63000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000010', 'delivered', 14.99, 'PAYPAL-ORD-004', 'Elizabeth Martinez', '110 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456787', now() - interval '35 days', now() - interval '31 days'),
  ('63000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-00000000000f', 'delivered', 49.99, 'PAYPAL-ORD-005', 'Jessica Sanchez', '115 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456788', now() - interval '30 days', now() - interval '26 days'),
  ('63000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000014', 'shipped', 24.99, 'PAYPAL-ORD-006', 'Susan Wilson', '119 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456789', now() - interval '6 days', now() - interval '4 days'),
  ('63000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-00000000001c', 'shipped', 39.99, 'PAYPAL-ORD-007', 'Margaret Thompson', '127 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456790', now() - interval '5 days', now() - interval '3 days'),
  ('63000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000020', 'paid', 64.98, 'PAYPAL-ORD-008', 'Sandra Robinson', '131 Main St', 'Tampa', 'FL', '33614', null, now() - interval '2 days', now() - interval '2 days'),
  ('63000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000025', 'paid', 49.99, 'PAYPAL-ORD-009', 'Steven Harris', '136 Main St', 'Tampa', 'FL', '33614', null, now() - interval '1 days', now() - interval '1 days'),
  ('63000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000002a', 'pending', 24.99, null, 'Kimberly Walker', '141 Main St', 'Tampa', 'FL', '33614', null, now() - interval '6 hours', now() - interval '6 hours'),
  ('63000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000003c', 'cancelled', 22.99, null, 'Paul Allen', '152 Main St', 'Tampa', 'FL', '33614', null, now() - interval '15 days', now() - interval '14 days'),
  ('63000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-000000000050', 'delivered', 79.97, 'PAYPAL-ORD-012', 'Stephanie Roberts', '180 Main St', 'Tampa', 'FL', '33614', '1Z999AA10123456791', now() - interval '70 days', now() - interval '64 days');

-- Order items
insert into order_items (order_id, variant_id, quantity, price_at_purchase) values
  -- Order 1: 2 logo tees
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 2, 24.99),
  -- Order 2: 1 logo tee
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000003', 1, 24.99),
  -- Order 3: hoodie + tee
  ('63000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000006', 1, 49.99),
  ('63000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', 1, 14.99),  -- mock low-cost line
  -- Order 4: pocket mask
  ('63000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000009', 1, 14.99),
  -- Order 5: hoodie
  ('63000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000007', 1, 49.99),
  -- Order 6: logo tee
  ('63000000-0000-0000-0000-000000000006', '61000000-0000-0000-0000-000000000002', 1, 24.99),
  -- Order 7: polo
  ('63000000-0000-0000-0000-000000000007', '61000000-0000-0000-0000-00000000000c', 1, 39.99),
  -- Order 8: hoodie + tee
  ('63000000-0000-0000-0000-000000000008', '61000000-0000-0000-0000-000000000005', 1, 49.99),
  ('63000000-0000-0000-0000-000000000008', '61000000-0000-0000-0000-000000000001', 1, 14.99),
  -- Order 9: hoodie
  ('63000000-0000-0000-0000-000000000009', '61000000-0000-0000-0000-000000000006', 1, 49.99),
  -- Order 10: tee (pending)
  ('63000000-0000-0000-0000-00000000000a', '61000000-0000-0000-0000-000000000002', 1, 24.99),
  -- Order 11: cap (cancelled)
  ('63000000-0000-0000-0000-00000000000b', '61000000-0000-0000-0000-00000000000e', 1, 22.99),
  -- Order 12: 2 hoodies + tee + masks
  ('63000000-0000-0000-0000-00000000000c', '61000000-0000-0000-0000-000000000006', 1, 49.99),
  ('63000000-0000-0000-0000-00000000000c', '61000000-0000-0000-0000-000000000003', 1, 14.99),
  ('63000000-0000-0000-0000-00000000000c', '61000000-0000-0000-0000-000000000009', 1, 14.99);

-- =============================================================================
-- CONTACT SUBMISSIONS + REPLIES
-- =============================================================================
insert into contact_submissions (id, name, email, phone, inquiry_type, message, replied, created_at) values
  -- Unreplied (5)
  ('70000000-0000-0000-0000-000000000001', 'Megan Coombs',    'megan@coombsfamily.example',     '813-555-0901', 'general',     'Hi, do you offer private one-on-one CPR training in someone''s home? My elderly father wants to learn but doesn''t want a class setting.', false, now() - interval '6 hours'),
  ('70000000-0000-0000-0000-000000000002', 'David Park',      'david.park@hawksnest.example',    '813-555-0902', 'group',       'We''re a soccer parent group, about 12 of us. Can we book a private session at our community center?', false, now() - interval '1 day'),
  ('70000000-0000-0000-0000-000000000003', 'Yolanda Reeves',  'yolanda@yreeves.example',         '813-555-0903', 'pricing',     'What''s the difference between BLS and Heartsaver, and which one do I need for my new job at a daycare?', false, now() - interval '2 days'),
  ('70000000-0000-0000-0000-000000000004', 'Carlos Estrada',  'carlos.estrada@tgh.example',      '813-555-0904', 'corporate',   'Tampa General is looking to recertify ~80 nurses across the next quarter. Can we schedule a call to discuss?', false, now() - interval '3 days'),
  ('70000000-0000-0000-0000-000000000005', 'Sam Petrocelli',  'sam.p@example.com',               null,           'cert',        'I lost my certification card from a class I took with you last year. Can I get a replacement?', false, now() - interval '4 days'),
  -- Replied (3)
  ('70000000-0000-0000-0000-000000000006', 'Helen Vargas',    'helen.vargas@example.com',        '813-555-0906', 'general',     'Do you teach Pediatric CPR for grandparents? My daughter just had a baby.', true,  now() - interval '12 days'),
  ('70000000-0000-0000-0000-000000000007', 'Brent Calloway',  'brent@calloway-fitness.example',  '813-555-0907', 'group',       'I run a CrossFit gym and want to certify all my coaches. 8 coaches, BLS-level. What''s your group rate?', true,  now() - interval '20 days'),
  ('70000000-0000-0000-0000-000000000008', 'Priscilla Howe',  'priscilla.howe@example.com',      null,           'pricing',     'Just want to know what your standard CPR + AED class costs.', true, now() - interval '30 days');

insert into contact_replies (submission_id, sent_by, subject, body, zoho_message_id, has_attachments, created_at) values
  ('70000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'Re: Pediatric CPR for grandparents',
   'Hi Helen, congratulations on your new grandchild! Yes — our Pediatric CPR class is exactly what you''re looking for. We have one coming up in 10 days at our Home Base. Booking link: https://staging.superherocpr.com/book/pediatric-cpr — Lisa, Superhero CPR',
   'ZOHO-MSG-001', false, now() - interval '11 days'),
  ('70000000-0000-0000-0000-000000000007', current_setting('seed.danny_id')::uuid, 'Re: Group BLS for CrossFit coaches',
   'Brent — happy to help. For 8 coaches we can do a group BLS at $60/student (down from $65) at your gym, with a custom invoice. I''ll have one of our instructors reach out this week to schedule. — Danny',
   'ZOHO-MSG-002', false, now() - interval '19 days'),
  ('70000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000003', 'Re: CPR + AED pricing',
   'Hi Priscilla — our standard CPR + AED class is $50 per person. Schedule and booking: https://staging.superherocpr.com/schedule. Let me know if you''d like me to hold a spot. — Marcus',
   'ZOHO-MSG-003', false, now() - interval '29 days');

-- =============================================================================
-- SOCIAL FEED CACHE
-- =============================================================================
insert into social_feed_cache (id, facebook_post_id, photo_url, post_url, caption, posted_at, cached_at) values
  ('80000000-0000-0000-0000-000000000001', 'FB-1001', 'https://placehold.co/600x600?text=Class+1', 'https://www.facebook.com/1HeroWay/posts/1001', 'Another full BLS class at home base today! Welcome to the team. #CPRsavesLives', now() - interval '2 days', now() - interval '2 days'),
  ('80000000-0000-0000-0000-000000000002', 'FB-1002', 'https://placehold.co/600x600?text=Class+2', 'https://www.facebook.com/1HeroWay/posts/1002', 'Big shoutout to the @TampaGeneralHospital nursing team for their recert today. You all crushed it.', now() - interval '8 days', now() - interval '8 days'),
  ('80000000-0000-0000-0000-000000000003', 'FB-1003', 'https://placehold.co/600x600?text=Class+3', 'https://www.facebook.com/1HeroWay/posts/1003', 'Pediatric CPR — because every parent should know this. New class added next month.', now() - interval '14 days', now() - interval '14 days'),
  ('80000000-0000-0000-0000-000000000004', 'FB-1004', 'https://placehold.co/600x600?text=Class+4', 'https://www.facebook.com/1HeroWay/posts/1004', 'On-site at Raymond James Stadium training game-day medics. Go Bucs.', now() - interval '21 days', now() - interval '21 days'),
  ('80000000-0000-0000-0000-000000000005', 'FB-1005', 'https://placehold.co/600x600?text=Class+5', 'https://www.facebook.com/1HeroWay/posts/1005', 'Hands-on practice = real skills. Books open for May.', now() - interval '30 days', now() - interval '30 days'),
  ('80000000-0000-0000-0000-000000000006', 'FB-1006', 'https://placehold.co/600x600?text=Class+6', 'https://www.facebook.com/1HeroWay/posts/1006', 'Heartsaver CPR/AED. 2 hours. One skill that could save a life.', now() - interval '40 days', now() - interval '40 days');

-- =============================================================================
-- SYSTEM SETTINGS
-- =============================================================================
insert into system_settings (key, value) values
  ('business_name',                     'Superhero CPR'),
  ('business_email',                    'info@superherocpr.com'),
  ('business_phone',                    '813-555-0100'),
  ('business_address',                  '4321 N Himes Ave, Tampa, FL 33614'),
  ('default_class_capacity',            '8'),
  ('booking_lead_time_hours',           '24'),
  ('cert_reminder_days_before_expiry',  '60'),
  ('correction_window_hours',           '48'),
  ('low_stock_default_threshold',       '5'),
  ('platform_fee_percent',              '20'),
  ('paypal_business_merchant_id',       'PAYPAL_BIZ_MAIN'),
  ('zoho_from_address',                 'noreply@superherocpr.com'),
  ('facebook_page_id',                  'superherocpr'),
  ('rollcall_code_length',              '6'),
  ('seed_completed_at',                 to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'));

-- =============================================================================
-- CLEANUP — drop the helper function
-- =============================================================================
drop function _seed_create_auth_user(uuid, text, text);

-- Tell PostgREST to reload its schema cache so the new tables are exposed.
notify pgrst, 'reload schema';

-- =============================================================================
-- DONE
-- =============================================================================
do $$
declare
  cust_count int;
  staff_count int;
  session_count int;
  booking_count int;
  payment_count int;
  cert_count int;
  invoice_count int;
  order_count int;
begin
  select count(*) into cust_count    from profiles where role = 'customer';
  select count(*) into staff_count   from profiles where role <> 'customer';
  select count(*) into session_count from class_sessions;
  select count(*) into booking_count from bookings;
  select count(*) into payment_count from payments;
  select count(*) into cert_count    from certifications;
  select count(*) into invoice_count from invoices;
  select count(*) into order_count   from orders;
  raise notice 'Seed complete:';
  raise notice '  Staff:           %', staff_count;
  raise notice '  Customers:       %', cust_count;
  raise notice '  Sessions:        %', session_count;
  raise notice '  Bookings:        %', booking_count;
  raise notice '  Payments:        %', payment_count;
  raise notice '  Certifications:  %', cert_count;
  raise notice '  Invoices:        %', invoice_count;
  raise notice '  Orders:          %', order_count;
  raise notice 'Default password for all accounts: TestPass123!';
end $$;
