-- =============================================================================
-- Migration 0018: Add PEARS® and ACLS EP cert types and class types
--
-- What this does:
--   1. Inserts 4 new AHA eCard cert types: PEARS® Provider, PEARS® Instructor,
--      ACLS EP, and ACLS EP Instructor.
--   2. Inserts 4 matching class types (active=false — prices/durations are
--      placeholders that must be reviewed in the admin panel before publishing).
--
-- Run AFTER migration 0012 (cert_type_id column on class_types must exist).
-- Safe to re-run: ON CONFLICT DO NOTHING on all inserts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Insert the 4 new AHA eCard cert types
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Step 2: Insert the 4 matching class types
-- All start as active=false — admin must set correct prices/durations before
-- publishing to the schedule. ON CONFLICT (name) DO NOTHING makes this re-runnable.
-- -----------------------------------------------------------------------------
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
