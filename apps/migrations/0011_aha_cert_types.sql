-- =============================================================================
-- Migration 0011: Replace generic cert types with 13 official AHA eCard names
--
-- What this does:
--   1. Inserts all 13 AHA eCard cert types with the exact names that match the
--      CERT_CONFIGS lookup table in apps/web/lib/cert-utils.ts.
--   2. Remaps any existing certifications that point to old generic cert type
--      rows to the closest matching new AHA cert type (by name lookup — safe
--      because cert_types.name is UNIQUE).
--   3. Deletes the old generic cert type rows.
--
-- Safe to run on any environment. Handles old names from both seed.sql
-- ('BLS for Healthcare Providers' style) and seed-staging.sql ('BLS' style).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Insert the 13 official AHA eCard cert types
-- ON CONFLICT on name means re-running this migration is safe.
-- -----------------------------------------------------------------------------
INSERT INTO cert_types (name, description, validity_months, issuing_body, active)
VALUES
  ('Heartsaver® First Aid eCard',
   'AHA Heartsaver First Aid certification. Covers adult/child/infant first aid, emergency action steps, and injury response.',
   24, 'American Heart Association', true),

  ('Heartsaver® CPR AED eCard',
   'AHA Heartsaver CPR and AED certification. Covers adult/child/infant CPR, AED use, and choking relief.',
   24, 'American Heart Association', true),

  ('Heartsaver® First Aid CPR AED eCard',
   'AHA Heartsaver combined First Aid, CPR, and AED certification. Full coverage for workplace and community responders.',
   24, 'American Heart Association', true),

  ('Heartsaver® Pediatric First Aid CPR AED eCard',
   'AHA Heartsaver certification for pediatric caregivers. Covers infant/child CPR, AED, choking, and pediatric first aid.',
   24, 'American Heart Association', true),

  ('Heartsaver® for K-12 Schools eCard',
   'AHA Heartsaver certification designed for school staff. Covers adult/child CPR, AED use, and first aid for the school environment.',
   24, 'American Heart Association', true),

  ('BLS Provider eCard',
   'AHA Basic Life Support certification for healthcare providers. Covers high-quality CPR for adults, children, and infants, AED use, and team resuscitation.',
   24, 'American Heart Association', true),

  ('ACLS Provider eCard',
   'AHA Advanced Cardiovascular Life Support certification. Covers systematic approach to ACLS, cardiac arrest algorithms, and resuscitation pharmacology.',
   24, 'American Heart Association', true),

  ('PALS Provider eCard',
   'AHA Pediatric Advanced Life Support certification. Covers recognition and management of respiratory distress, shock, and cardiac arrest in children.',
   24, 'American Heart Association', true),

  ('Heartsaver® Instructor eCard',
   'AHA Heartsaver Instructor certification. Authorizes teaching of Heartsaver-level CPR, AED, and First Aid courses.',
   24, 'American Heart Association', true),

  ('BLS Instructor eCard',
   'AHA BLS Instructor certification. Authorizes teaching of BLS Provider courses for healthcare settings.',
   24, 'American Heart Association', true),

  ('ACLS Instructor eCard',
   'AHA ACLS Instructor certification. Authorizes teaching of Advanced Cardiovascular Life Support courses.',
   24, 'American Heart Association', true),

  ('PALS Instructor eCard',
   'AHA PALS Instructor certification. Authorizes teaching of Pediatric Advanced Life Support courses.',
   24, 'American Heart Association', true),

  ('Advisor: BLS eCard',
   'AHA BLS Training Site Faculty/Advisor designation. Authorizes oversight of BLS Instructor candidates during monitored training.',
   24, 'American Heart Association', true)

ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Step 2: Remap existing certifications to the new cert types
-- Handles old names from both seed environments.
-- The sub-SELECT will return NULL if the old name doesn't exist, so only rows
-- that match a known old name are updated.
-- -----------------------------------------------------------------------------

-- BLS variants → BLS Provider eCard
UPDATE certifications
   SET cert_type_id = (SELECT id FROM cert_types WHERE name = 'BLS Provider eCard')
 WHERE cert_type_id IN (
   SELECT id FROM cert_types WHERE name IN ('BLS', 'BLS (Basic Life Support)')
 );

-- Heartsaver CPR/AED variants → Heartsaver® CPR AED eCard
UPDATE certifications
   SET cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® CPR AED eCard')
 WHERE cert_type_id IN (
   SELECT id FROM cert_types WHERE name IN ('Heartsaver CPR/AED', 'Heartsaver CPR+AED')
 );

-- Generic CPR+AED / First Aid standalone → Heartsaver® First Aid CPR AED eCard
UPDATE certifications
   SET cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® First Aid CPR AED eCard')
 WHERE cert_type_id IN (
   SELECT id FROM cert_types WHERE name IN ('CPR + AED', 'CPR+AED for Friends & Family', 'First Aid (standalone)')
 );

-- Pediatric variants → Heartsaver® Pediatric First Aid CPR AED eCard
UPDATE certifications
   SET cert_type_id = (SELECT id FROM cert_types WHERE name = 'Heartsaver® Pediatric First Aid CPR AED eCard')
 WHERE cert_type_id IN (
   SELECT id FROM cert_types WHERE name IN ('Pediatric CPR', 'Pediatric First Aid CPR+AED')
 );

-- -----------------------------------------------------------------------------
-- Step 3: Delete the old generic cert type rows (now that all FKs are remapped)
-- -----------------------------------------------------------------------------
DELETE FROM cert_types
 WHERE name IN (
   'BLS',
   'BLS (Basic Life Support)',
   'Heartsaver CPR/AED',
   'Heartsaver CPR+AED',
   'CPR + AED',
   'CPR+AED for Friends & Family',
   'First Aid (standalone)',
   'Pediatric CPR',
   'Pediatric First Aid CPR+AED'
 );
