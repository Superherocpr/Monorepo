-- Migration: 0081_invoice_travel_fee
--
-- Stores an invoice's travel fee on its own instead of leaving it buried in
-- total_amount.
--
-- WHY: editing a sent invoice (POST /api/invoices/edit) needs the travel fee as
-- a separate number. Recovering it as total - students x price is wrong for
-- custom-total invoices, where the per-student price is the total divided by the
-- student count and rounded to cents (100 / 3 = 33.33, so 3 x 33.33 = 99.99 and
-- a stray $0.01 "fee" would appear).
--
-- BACKFILL: team invoices are flat (student_count = 0, amount_per_student = the
-- base price), so their fee is total - amount_per_student exactly. Per-student
-- invoices use total - students x price, but only when that is at least $1, so
-- cents of rounding are never mistaken for a fee. Every real fee in use
-- ($65 default) clears that bar.
--
-- Safe to re-run. Additive only.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS travel_fee numeric(10,2) NOT NULL DEFAULT 0
  CHECK (travel_fee >= 0);

UPDATE invoices
SET travel_fee = CASE
  WHEN student_count = 0 THEN GREATEST(0, ROUND((total_amount - amount_per_student)::numeric, 2))
  WHEN total_amount - student_count * amount_per_student >= 1
    THEN ROUND((total_amount - student_count * amount_per_student)::numeric, 2)
  ELSE 0
END
WHERE travel_fee = 0;
