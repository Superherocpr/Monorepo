-- =============================================================================
-- Migration 0012: Add cert_type_id to class_types; rename to official AHA names;
--                 add 9 new AHA class types
--
-- What this does:
--   1. Adds a nullable cert_type_id FK column to class_types. Nullable because
--      some special sessions (e.g. community events) may not issue a cert.
--   2. Renames the 4–5 old generic class types to their official AHA course
--      names and wires cert_type_id to the matching cert type.
--   3. Inserts 9 new AHA class types (active=false — prices are placeholders
--      that must be set in the admin panel before publishing to the schedule).
--
-- Run AFTER migration 0011 (cert_types must exist first for the FK lookups).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, ON CONFLICT DO NOTHING on inserts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Add cert_type_id column (idempotent — does nothing if already exists)
-- -----------------------------------------------------------------------------
ALTER TABLE class_types
  ADD COLUMN IF NOT EXISTS cert_type_id uuid REFERENCES cert_types(id);

-- -----------------------------------------------------------------------------
-- Step 2: Rename existing class types to official AHA names + assign cert_type_id
-- All renames are done by name so they work regardless of the UUID assigned by
-- the environment (prod, staging, or dev seed).
-- -----------------------------------------------------------------------------

-- BLS Provider (was 'BLS for Healthcare Providers' in seed.sql, or 'BLS (Basic Life Support)' in seed-staging.sql)
UPDATE class_types
   SET name         = 'BLS Provider',
       description  = 'AHA-certified Basic Life Support for healthcare providers. Covers high-quality CPR for adults, children, and infants, AED use, and team resuscitation dynamics.',
       cert_type_id = (SELECT id FROM cert_types WHERE name = 'BLS Provider eCard')
 WHERE name IN ('BLS for Healthcare Providers', 'BLS (Basic Life Support)');

-- Heartsaver® CPR AED (was 'Heartsaver CPR+AED' or 'Heartsaver CPR/AED')
UPDATE class_types
   SET name         = 'Heartsaver® CPR AED',
       description  = 'AHA-certified CPR and AED training for the general public and workplace responders. Covers adult, child, and infant CPR and AED use.',
       cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® CPR AED eCard')
 WHERE name IN ('Heartsaver CPR+AED', 'Heartsaver CPR/AED');

-- Heartsaver® Pediatric First Aid CPR AED (was 'Pediatric First Aid CPR+AED' or 'Pediatric CPR')
UPDATE class_types
   SET name         = 'Heartsaver® Pediatric First Aid CPR AED',
       description  = 'AHA-certified pediatric course for childcare providers, parents, and school staff. Covers infant and child CPR, AED use, choking relief, and pediatric first aid.',
       cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® Pediatric First Aid CPR AED eCard')
 WHERE name IN ('Pediatric First Aid CPR+AED', 'Pediatric CPR');

-- Heartsaver® First Aid CPR AED (was 'CPR+AED for Friends & Family' or 'CPR + AED')
UPDATE class_types
   SET name         = 'Heartsaver® First Aid CPR AED',
       description  = 'AHA-certified combined First Aid, CPR, and AED course for the general public and workplace settings. The most comprehensive Heartsaver certification available.',
       cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® First Aid CPR AED eCard')
 WHERE name IN ('CPR+AED for Friends & Family', 'CPR + AED');

-- Heartsaver® First Aid (was 'First Aid (standalone)' in seed-staging.sql)
UPDATE class_types
   SET name         = 'Heartsaver® First Aid',
       description  = 'AHA-certified standalone First Aid course. Covers emergency action steps, bleeding control, burns, head/neck injuries, and medical emergencies.',
       cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® First Aid eCard')
 WHERE name = 'First Aid (standalone)';

-- -----------------------------------------------------------------------------
-- Step 3: Insert the 9 remaining AHA class types
-- All start as active=false — admin must review and set correct prices/durations
-- before these appear on the public schedule.
-- ON CONFLICT (name) DO NOTHING makes this safe to re-run.
-- -----------------------------------------------------------------------------
INSERT INTO class_types (name, description, duration_minutes, max_capacity, price, active, cert_type_id)
VALUES

  ('Heartsaver® First Aid',
   'AHA-certified standalone First Aid course. Covers emergency action steps, bleeding control, burns, head/neck injuries, and medical emergencies.',
   180, 16, 55.00, false,
   (SELECT id FROM cert_types WHERE name = 'Heartsaver® First Aid eCard')),

  ('Heartsaver® for K-12 Schools',
   'AHA-certified CPR and First Aid course designed for school faculty and staff. Meets many school district training requirements.',
   180, 16, 55.00, false,
   (SELECT id FROM cert_types WHERE name = 'Heartsaver® for K-12 Schools eCard')),

  ('ACLS Provider',
   'AHA Advanced Cardiovascular Life Support course for healthcare providers. Covers systematic ACLS approach, arrhythmia recognition, cardiac arrest algorithms, and resuscitation pharmacology.',
   480, 12, 150.00, false,
   (SELECT id FROM cert_types WHERE name = 'ACLS Provider eCard')),

  ('PALS Provider',
   'AHA Pediatric Advanced Life Support course for healthcare providers. Covers recognition and management of respiratory distress, shock, and cardiac arrest in pediatric patients.',
   480, 12, 150.00, false,
   (SELECT id FROM cert_types WHERE name = 'PALS Provider eCard')),

  ('Heartsaver® Instructor',
   'AHA Heartsaver Instructor course. Trains and certifies instructors to teach Heartsaver CPR, AED, and First Aid courses.',
   480, 12, 200.00, false,
   (SELECT id FROM cert_types WHERE name = 'Heartsaver® Instructor eCard')),

  ('BLS Instructor',
   'AHA BLS Instructor course. Trains and certifies instructors to teach BLS Provider courses in healthcare settings.',
   480, 12, 200.00, false,
   (SELECT id FROM cert_types WHERE name = 'BLS Instructor eCard')),

  ('ACLS Instructor',
   'AHA ACLS Instructor course. Trains and certifies instructors to teach Advanced Cardiovascular Life Support courses.',
   480, 12, 300.00, false,
   (SELECT id FROM cert_types WHERE name = 'ACLS Instructor eCard')),

  ('PALS Instructor',
   'AHA PALS Instructor course. Trains and certifies instructors to teach Pediatric Advanced Life Support courses.',
   480, 12, 300.00, false,
   (SELECT id FROM cert_types WHERE name = 'PALS Instructor eCard')),

  ('Advisor: BLS',
   'AHA BLS Training Site Faculty course. Authorizes experienced instructors to monitor, evaluate, and mentor BLS Instructor candidates.',
   240, 12, 100.00, false,
   (SELECT id FROM cert_types WHERE name = 'Advisor: BLS eCard'))

ON CONFLICT (name) DO NOTHING;
