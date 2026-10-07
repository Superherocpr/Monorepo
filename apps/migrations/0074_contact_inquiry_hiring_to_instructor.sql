-- 0074_contact_inquiry_hiring_to_instructor.sql
--
-- The contact form's "Hiring" inquiry type was replaced by "Instructor"
-- (lib/contact-constants.ts). contact_submissions.inquiry_type is free text,
-- so existing rows keep the old label unless backfilled; the admin type filter
-- only lists current types, which would leave old rows unfilterable.
--
-- Data-only and idempotent: re-running matches no rows.

UPDATE contact_submissions
SET inquiry_type = 'Instructor'
WHERE inquiry_type = 'Hiring';
