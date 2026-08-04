-- Migration 0022: SuperHeroCPR branded cert type
-- Adds a SuperHeroCPR-issued certificate option for classes that issue
-- the company's own branded card rather than an AHA eCard.
-- Valid for 24 months to match AHA cert validity.

INSERT INTO cert_types (name, description, validity_months, issuing_body, active)
VALUES (
  'SuperHeroCPR Certificate',
  'SuperHeroCPR-issued CPR/First Aid completion certificate.',
  24,
  'SuperHeroCPR',
  true
)
ON CONFLICT (name) DO NOTHING;
