-- Migration 0020: Instructor payout accounting
--
-- Moves the app from instructor-routed collections to platform-collected funds
-- with instructor payouts. Customers pay SuperHeroCPR; the app records what
-- each instructor is owed and sends those owed amounts through PayPal Payouts.

-- Retire the old instructor OAuth/routing model. Payouts now need only an
-- instructor PayPal email, and stale OAuth tokens should not remain in storage.
DROP TABLE IF EXISTS instructor_payment_accounts;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS payment_routing;

-- Store the PayPal email address where an instructor wants payouts sent.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS paypal_payout_email TEXT;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_paypal_payout_email_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_paypal_payout_email_check
    CHECK (
      paypal_payout_email IS NULL
      OR paypal_payout_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    );

-- The default SuperHeroCPR cut is configurable in system_settings.
-- App code also supports PLATFORM_FEE_PERCENT as an env fallback.
INSERT INTO system_settings (key, value)
VALUES ('platform_fee_percent', '20')
ON CONFLICT (key) DO NOTHING;

-- One row per booking or paid invoice that generated instructor compensation.
CREATE TABLE IF NOT EXISTS instructor_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES profiles(id),
  source_type text NOT NULL CHECK (source_type IN ('booking', 'invoice')),
  booking_id uuid REFERENCES bookings(id),
  invoice_id uuid REFERENCES invoices(id),
  payment_id uuid REFERENCES payments(id),
  gross_amount numeric(10,2) NOT NULL CHECK (gross_amount >= 0),
  platform_fee_percent numeric(5,2) NOT NULL CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  platform_fee_amount numeric(10,2) NOT NULL CHECK (platform_fee_amount >= 0),
  instructor_amount numeric(10,2) NOT NULL CHECK (instructor_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payout_pending', 'paid', 'cancelled', 'failed')),
  payout_batch_id uuid,
  payout_item_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instructor_earnings_source_check CHECK (
    (source_type = 'booking' AND booking_id IS NOT NULL AND invoice_id IS NULL)
    OR
    (source_type = 'invoice' AND invoice_id IS NOT NULL AND booking_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS instructor_earnings_booking_unique
  ON instructor_earnings (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS instructor_earnings_invoice_unique
  ON instructor_earnings (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS instructor_earnings_status_idx
  ON instructor_earnings (status, instructor_id);

-- A PayPal payout batch created from pending instructor earnings.
CREATE TABLE IF NOT EXISTS instructor_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'completed', 'failed')),
  sender_batch_id text NOT NULL UNIQUE,
  paypal_payout_batch_id text,
  total_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  item_count int NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz
);

-- One grouped payout item per instructor inside a batch.
CREATE TABLE IF NOT EXISTS instructor_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_batch_id uuid NOT NULL REFERENCES instructor_payout_batches(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES profiles(id),
  recipient_email text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'completed', 'failed')),
  paypal_payout_item_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instructor_payout_items_batch_idx
  ON instructor_payout_items (payout_batch_id);

CREATE INDEX IF NOT EXISTS instructor_payout_items_instructor_idx
  ON instructor_payout_items (instructor_id, status);

-- Payout tables contain compensation amounts and recipient emails. They are
-- accessed only through server-side admin routes that use the service role.
ALTER TABLE instructor_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE instructor_earnings FROM anon, authenticated;
REVOKE ALL ON TABLE instructor_payout_batches FROM anon, authenticated;
REVOKE ALL ON TABLE instructor_payout_items FROM anon, authenticated;

GRANT ALL ON TABLE instructor_earnings TO service_role;
GRANT ALL ON TABLE instructor_payout_batches TO service_role;
GRANT ALL ON TABLE instructor_payout_items TO service_role;

ALTER TABLE instructor_earnings
  DROP CONSTRAINT IF EXISTS instructor_earnings_payout_batch_id_fkey;

ALTER TABLE instructor_earnings
  ADD CONSTRAINT instructor_earnings_payout_batch_id_fkey
    FOREIGN KEY (payout_batch_id) REFERENCES instructor_payout_batches(id);

ALTER TABLE instructor_earnings
  DROP CONSTRAINT IF EXISTS instructor_earnings_payout_item_id_fkey;

ALTER TABLE instructor_earnings
  ADD CONSTRAINT instructor_earnings_payout_item_id_fkey
    FOREIGN KEY (payout_item_id) REFERENCES instructor_payout_items(id);

-- reserve_instructor_payout_batch(p_actor_id)
-- Atomically gathers all pending, payable earnings for instructors with a
-- payout email, groups them by instructor, creates a payout batch + items, and
-- marks those earnings payout_pending so a second click cannot double-pay them.
CREATE OR REPLACE FUNCTION reserve_instructor_payout_batch(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid;
  v_sender_batch_id text;
  v_total numeric(10,2);
  v_item_count int;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_actor_id
      AND role = 'super_admin'
      AND archived = false
      AND deactivated = false
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = 'P0001';
  END IF;

  DROP TABLE IF EXISTS pg_temp.reserve_payout_eligible;

  CREATE TEMP TABLE reserve_payout_eligible ON COMMIT DROP AS
  SELECT
    e.id AS earning_id,
    e.instructor_id,
    e.instructor_amount,
    lower(trim(p.paypal_payout_email)) AS recipient_email
  FROM instructor_earnings e
  JOIN profiles p ON p.id = e.instructor_id
  WHERE e.status = 'pending'
    AND e.instructor_amount > 0
    AND p.paypal_payout_email IS NOT NULL
    AND trim(p.paypal_payout_email) <> ''
    AND p.deactivated = false
    AND p.archived = false
  FOR UPDATE OF e SKIP LOCKED;

  SELECT
    coalesce(round(sum(instructor_amount)::numeric, 2), 0),
    count(DISTINCT instructor_id)
  INTO v_total, v_item_count
  FROM reserve_payout_eligible;

  IF v_item_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_eligible_earnings'
    );
  END IF;

  v_sender_batch_id := 'shcpr-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO instructor_payout_batches (
    created_by,
    status,
    sender_batch_id,
    total_amount,
    item_count
  )
  VALUES (
    p_actor_id,
    'pending',
    v_sender_batch_id,
    v_total,
    v_item_count
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO instructor_payout_items (
    payout_batch_id,
    instructor_id,
    recipient_email,
    amount,
    status
  )
  SELECT
    v_batch_id,
    instructor_id,
    recipient_email,
    round(sum(instructor_amount)::numeric, 2),
    'pending'
  FROM reserve_payout_eligible
  GROUP BY instructor_id, recipient_email;

  UPDATE instructor_earnings e
  SET
    status = 'payout_pending',
    payout_batch_id = v_batch_id,
    payout_item_id = i.id,
    updated_at = now()
  FROM reserve_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  WHERE e.id = eligible.earning_id;

  SELECT jsonb_build_object(
    'success', true,
    'batch', jsonb_build_object(
      'id', b.id,
      'sender_batch_id', b.sender_batch_id,
      'total_amount', b.total_amount,
      'item_count', b.item_count
    ),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'instructor_id', i.instructor_id,
      'recipient_email', i.recipient_email,
      'amount', i.amount
    ) ORDER BY i.created_at), '[]'::jsonb)
  )
  INTO v_result
  FROM instructor_payout_batches b
  JOIN instructor_payout_items i ON i.payout_batch_id = b.id
  WHERE b.id = v_batch_id
  GROUP BY b.id, b.sender_batch_id, b.total_amount, b.item_count;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_instructor_payout_batch(uuid) TO service_role;
