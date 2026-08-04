-- =============================================================================
-- Superhero CPR — Grading Tool Test Seed (Idempotent)
-- Adds the data needed to test /admin/sessions/[id]/grades.
--
-- What this inserts:
--   1. preset_grades — 5 grade options (Fail, Near Pass, Pass, Merit, Distinction)
--   2. A completed class session (s9) — BLS at Home Base, status=completed
--   3. 8 roster_records for s9 — simulates students who attended via rollcall
--      Mix of graded (4) and ungraded (4) to test the progress bar mid-fill state
--
-- Depends on the base seed (seed.sql) having already been run:
--   - instructor_id (00000000-0000-0000-0000-000000000001) must exist in profiles
--   - class type ct_bls (22222222-0000-0000-0000-000000000001) must exist
--   - location loc_home (11111111-0000-0000-0000-000000000001) must exist
-- =============================================================================

SET search_path TO public, extensions;

DO $$
DECLARE
  -- Reuse IDs from the base seed
  instructor_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  ct_bls        uuid := '22222222-0000-0000-0000-000000000001'::uuid;
  loc_home      uuid := '11111111-0000-0000-0000-000000000001'::uuid;

  -- New completed session for grading tests
  s9 uuid := '33333333-0000-0000-0000-000000000009'::uuid;

  -- Preset grade IDs: prefix 77777777
  pg_fail        uuid := '77777777-0000-0000-0000-000000000001'::uuid;
  pg_near_pass   uuid := '77777777-0000-0000-0000-000000000002'::uuid;
  pg_pass        uuid := '77777777-0000-0000-0000-000000000003'::uuid;
  pg_merit       uuid := '77777777-0000-0000-0000-000000000004'::uuid;
  pg_distinction uuid := '77777777-0000-0000-0000-000000000005'::uuid;

  -- Roster record IDs: prefix 88888888
  -- IDs 001–008 for the 8 test students
BEGIN

  -- ============================================================================
  -- 1. PRESET GRADES
  --    value = integer grade, label = what the instructor sees on the button
  -- ============================================================================
  INSERT INTO preset_grades (id, value, label)
  VALUES
    (pg_fail,        70,  'Fail'),
    (pg_near_pass,   75,  'Near Pass'),
    (pg_pass,        85,  'Pass'),
    (pg_merit,       90,  'Merit'),
    (pg_distinction, 100, 'Distinction')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 2. COMPLETED SESSION (s9)
  --    BLS at Home Base, 1 day in the past, status=completed so the grading
  --    tool button on the session detail page is enabled.
  -- ============================================================================
  INSERT INTO class_sessions (
    id, class_type_id, instructor_id, location_id,
    starts_at, ends_at, max_capacity,
    status, approval_status, roster_imported
  )
  VALUES (
    s9, ct_bls, instructor_id, loc_home,
    (now() - interval '1 day')::date + time '09:00',
    (now() - interval '1 day')::date + time '13:00',
    12,
    'completed', 'approved', true
  )
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================================
  -- 3. ROSTER RECORDS (8 students)
  --    Students 001–004 already have grades — tests the partial progress state.
  --    Students 005–008 have no grade — tests the ungraded state.
  --    Employers are set on some students to test that field rendering.
  -- ============================================================================

  -- Graded students (grade already set)
  INSERT INTO roster_records (id, session_id, first_name, last_name, email, employer, grade, confirmed)
  VALUES
    ('88888888-0000-0000-0000-000000000001'::uuid, s9, 'Jordan',   'Barnes',   'jordan.barnes@example.com',   'Tampa General Hospital',  85, true),
    ('88888888-0000-0000-0000-000000000002'::uuid, s9, 'Morgan',   'Chen',     'morgan.chen@example.com',     'St. Joseph''s Hospital',  100, true),
    ('88888888-0000-0000-0000-000000000003'::uuid, s9, 'Taylor',   'Nguyen',   'taylor.nguyen@example.com',   NULL,                       70, true),
    ('88888888-0000-0000-0000-000000000004'::uuid, s9, 'Casey',    'Rivera',   'casey.rivera@example.com',    'Bay Pines VA',             90, true)
  ON CONFLICT (id) DO NOTHING;

  -- Ungraded students (grade is NULL — these need to be graded in the tool)
  INSERT INTO roster_records (id, session_id, first_name, last_name, email, employer, grade, confirmed)
  VALUES
    ('88888888-0000-0000-0000-000000000005'::uuid, s9, 'Riley',    'Patel',    'riley.patel@example.com',     'AdventHealth',             NULL, true),
    ('88888888-0000-0000-0000-000000000006'::uuid, s9, 'Avery',    'Kim',      'avery.kim@example.com',       NULL,                       NULL, true),
    ('88888888-0000-0000-0000-000000000007'::uuid, s9, 'Drew',     'Hassan',   'drew.hassan@example.com',     'Moffitt Cancer Center',    NULL, false),
    ('88888888-0000-0000-0000-000000000008'::uuid, s9, 'Reese',    'Walker',   'reese.walker@example.com',    NULL,                       NULL, false)
  ON CONFLICT (id) DO NOTHING;

END $$;

-- Quick verification — run these selects after executing to confirm data is present:
-- SELECT id, value, label FROM preset_grades ORDER BY value;
-- SELECT id, status, approval_status, starts_at FROM class_sessions WHERE id = '33333333-0000-0000-0000-000000000009';
-- SELECT id, first_name, last_name, grade FROM roster_records WHERE session_id = '33333333-0000-0000-0000-000000000009' ORDER BY last_name;
