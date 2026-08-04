-- Migration 0048: Payout tracking, PayPal fee capture, denial handling, and retries
--
-- Background: PayPal accepting a Payouts batch (HTTP 201, batch_status PENDING)
-- is not the same as PayPal delivering the money. A batch can be denied hours
-- later — risk review, funding failure, account limitation — with the funds
-- returned to the business account. Nothing in the app could record that.
--
-- This migration adds:
--   1. Real PayPal fee capture (inbound on payments, outbound on payout items)
--   2. An honest status model: assumed_complete vs confirmed completed vs denied
--   3. Denial audit columns (who marked it, why, and from which source)
--   4. Retry lineage so a denied batch can be resent as a linked new batch
--   5. instructor_payout_attempts — one row per earning per payout attempt,
--      which is what makes a targeted retry possible at all
--   6. processed_webhook_events — PayPal webhook replay protection
--   7. reserve_payout_retry_batch() RPC
--   8. An hourly cron job that reconciles batches against PayPal automatically
--
-- Deliberately NOT in scope: reversing instructor earnings when a booking is
-- refunded. That is handled as a separate business process and does not affect
-- what the instructor is owed.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PayPal fee capture
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A NULL fee means "not tracked", not "zero". Booking captures return a real
-- fee in seller_receivable_breakdown; PayPal-invoice payments and manually
-- logged cash/check payments do not, and stay NULL so the UI can be honest
-- about which totals are measured rather than guessed.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS paypal_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS net_amount numeric(10,2);

COMMENT ON COLUMN payments.paypal_fee_amount IS
  'PayPal processing fee from seller_receivable_breakdown.paypal_fee. NULL = not tracked (invoice or offline payment).';
COMMENT ON COLUMN payments.net_amount IS
  'Amount actually credited after PayPal fees. NULL = not tracked.';

-- Outbound: the Payouts fee PayPal charges to send the money, read from
-- payout_item_fee / batch_header.fees during sync or webhook reconciliation.
ALTER TABLE instructor_payout_items
  ADD COLUMN IF NOT EXISTS paypal_fee_amount numeric(10,2);

ALTER TABLE instructor_payout_batches
  ADD COLUMN IF NOT EXISTS paypal_fee_total numeric(10,2);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Status model
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Batch/item statuses before this migration: pending, submitted, completed, failed.
--
--   pending          reserved in the DB, nothing sent to PayPal yet
--   assumed_complete PayPal accepted it; delivery presumed but NOT confirmed
--   completed        confirmed SUCCESS via sync or webhook
--   denied           PayPal refused it after accepting; funds returned
--   failed           never left the app (API rejected the request outright)
--   needs_review     result genuinely unknown (network died mid-call) — a human
--                    must check PayPal before anything is retried
--
-- Splitting failed / denied / needs_review matters: the first two are safe to
-- resend, the third is the one that can double-pay if touched blindly.

-- Existing data must be migrated before the tighter constraint goes on.
ALTER TABLE instructor_payout_batches
  DROP CONSTRAINT IF EXISTS instructor_payout_batches_status_check;

ALTER TABLE instructor_payout_items
  DROP CONSTRAINT IF EXISTS instructor_payout_items_status_check;

-- 'submitted' meant "PayPal took it, we don't know the outcome" — that is
-- exactly what assumed_complete now means.
UPDATE instructor_payout_batches SET status = 'assumed_complete' WHERE status = 'submitted';
UPDATE instructor_payout_items   SET status = 'assumed_complete' WHERE status = 'submitted';

-- holdUncertainReservation() wrote these with a known message prefix while
-- overloading the 'failed' status. They are the dangerous ones — reclassify.
UPDATE instructor_payout_batches
   SET status = 'needs_review'
 WHERE status = 'failed'
   AND error_message LIKE 'PayPal result uncertain%';

UPDATE instructor_payout_items
   SET status = 'needs_review'
 WHERE status = 'failed'
   AND error_message LIKE 'PayPal result uncertain%';

ALTER TABLE instructor_payout_batches
  ADD CONSTRAINT instructor_payout_batches_status_check
    CHECK (status IN (
      'pending', 'assumed_complete', 'completed', 'denied', 'failed', 'needs_review'
    ));

-- Items additionally carry 'unclaimed': PayPal holds a payout for 30 days when
-- the recipient email has no PayPal account attached, then returns it. Without
-- its own status this sat in limbo and silently reverted a month later.
ALTER TABLE instructor_payout_items
  ADD CONSTRAINT instructor_payout_items_status_check
    CHECK (status IN (
      'pending', 'assumed_complete', 'completed', 'denied', 'failed',
      'needs_review', 'unclaimed'
    ));

ALTER TABLE instructor_payout_items
  ADD COLUMN IF NOT EXISTS unclaimed_expires_at timestamptz;

COMMENT ON COLUMN instructor_payout_items.unclaimed_expires_at IS
  'When an UNCLAIMED payout expires at PayPal and the funds return (30 days from submission).';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Denial audit trail
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Marking a payout denied is an assertion that PayPal returned the money. If
-- that assertion is wrong, resending pays the instructor twice with no way to
-- claw it back — so every denial records who said so and on what basis.

ALTER TABLE instructor_payout_batches
  ADD COLUMN IF NOT EXISTS denied_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS denial_source text,
  ADD COLUMN IF NOT EXISTS denial_reason text;

ALTER TABLE instructor_payout_items
  ADD COLUMN IF NOT EXISTS denied_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS denial_source text,
  ADD COLUMN IF NOT EXISTS denial_reason text;

ALTER TABLE instructor_payout_batches
  DROP CONSTRAINT IF EXISTS instructor_payout_batches_denial_source_check;
ALTER TABLE instructor_payout_batches
  ADD CONSTRAINT instructor_payout_batches_denial_source_check
    CHECK (denial_source IS NULL OR denial_source IN ('manual', 'paypal_sync', 'webhook'));

ALTER TABLE instructor_payout_items
  DROP CONSTRAINT IF EXISTS instructor_payout_items_denial_source_check;
ALTER TABLE instructor_payout_items
  ADD CONSTRAINT instructor_payout_items_denial_source_check
    CHECK (denial_source IS NULL OR denial_source IN ('manual', 'paypal_sync', 'webhook'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Retry lineage
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE instructor_payout_batches
  ADD COLUMN IF NOT EXISTS retry_of_batch_id uuid;

ALTER TABLE instructor_payout_batches
  DROP CONSTRAINT IF EXISTS instructor_payout_batches_retry_of_fkey;

ALTER TABLE instructor_payout_batches
  ADD CONSTRAINT instructor_payout_batches_retry_of_fkey
    FOREIGN KEY (retry_of_batch_id) REFERENCES instructor_payout_batches(id);

CREATE INDEX IF NOT EXISTS instructor_payout_batches_retry_of_idx
  ON instructor_payout_batches (retry_of_batch_id)
  WHERE retry_of_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS instructor_payout_batches_status_idx
  ON instructor_payout_batches (status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Payout attempt history
-- ═══════════════════════════════════════════════════════════════════════════
--
-- One row per earning per payout attempt. This exists because reconciliation
-- clears instructor_earnings.payout_batch_id when an attempt fails — which
-- destroyed the only record of which earnings were in a denied batch, making a
-- targeted retry impossible. Attempts keep that link permanently, and give
-- every earning a readable history ("attempted 3 times, denied twice, then paid").

CREATE TABLE IF NOT EXISTS instructor_payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id uuid NOT NULL REFERENCES instructor_earnings(id) ON DELETE CASCADE,
  payout_batch_id uuid NOT NULL REFERENCES instructor_payout_batches(id) ON DELETE CASCADE,
  payout_item_id uuid REFERENCES instructor_payout_items(id) ON DELETE SET NULL,
  instructor_id uuid NOT NULL REFERENCES profiles(id),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  outcome text NOT NULL DEFAULT 'reserved' CHECK (outcome IN (
    'reserved', 'submitted', 'completed', 'denied', 'failed',
    'needs_review', 'unclaimed'
  )),
  note text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT instructor_payout_attempts_unique UNIQUE (earning_id, payout_batch_id)
);

CREATE INDEX IF NOT EXISTS instructor_payout_attempts_batch_idx
  ON instructor_payout_attempts (payout_batch_id);

CREATE INDEX IF NOT EXISTS instructor_payout_attempts_earning_idx
  ON instructor_payout_attempts (earning_id, attempted_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Webhook replay protection
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PayPal redelivers a webhook on any non-2xx response, so the same denial can
-- arrive several times. Keying on PayPal's own event id makes replays no-ops.

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  resource_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_webhook_events_received_idx
  ON processed_webhook_events (received_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RLS — payout data is compensation + recipient emails, server-side only
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE instructor_payout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE instructor_payout_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE processed_webhook_events FROM anon, authenticated;

GRANT ALL ON TABLE instructor_payout_attempts TO service_role;
GRANT ALL ON TABLE processed_webhook_events TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. reserve_instructor_payout_batch — now records attempt rows
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Unchanged behaviour except for the attempts INSERT at the end. Kept as one
-- atomic reservation using FOR UPDATE SKIP LOCKED so a double click or an
-- overlapping cron run cannot pay the same earning twice.

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

  -- Permanent record of which earnings went into this batch, so the link
  -- survives reconciliation clearing payout_batch_id on failure.
  INSERT INTO instructor_payout_attempts (
    earning_id,
    payout_batch_id,
    payout_item_id,
    instructor_id,
    amount,
    outcome
  )
  SELECT
    eligible.earning_id,
    v_batch_id,
    i.id,
    eligible.instructor_id,
    eligible.instructor_amount,
    'reserved'
  FROM reserve_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  ON CONFLICT (earning_id, payout_batch_id) DO NOTHING;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. reserve_payout_retry_batch — resend a denied or failed batch
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Builds a NEW batch from exactly the earnings of a denied/failed batch, linked
-- back via retry_of_batch_id and carrying a fresh sender_batch_id (PayPal
-- rejects a reused one as a duplicate).
--
-- Recipient emails are re-read from profiles rather than copied from the source
-- batch: a denial caused by a bad address is fixed by the instructor updating
-- it, and the retry should pick that up.
--
-- Refuses a partial retry. If any source earning has moved on (already paid, or
-- swept into a newer batch) or become unpayable, it returns a reason instead of
-- sending. Nothing is stranded by refusing — earnings released by a denial are
-- back to 'pending' and the normal "Send Payouts" flow still collects them.

CREATE OR REPLACE FUNCTION reserve_payout_retry_batch(
  p_actor_id uuid,
  p_source_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_status text;
  v_attempted_count int;
  v_moved_count int;
  v_blocked_count int;
  v_available_count int;
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

  SELECT status INTO v_source_status
  FROM instructor_payout_batches
  WHERE id = p_source_batch_id;

  IF v_source_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_batch_not_found');
  END IF;

  -- Only a batch we are certain did not deliver money may be retried.
  -- needs_review is excluded on purpose: its outcome is unknown.
  IF v_source_status NOT IN ('denied', 'failed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'source_batch_not_retryable',
      'status', v_source_status
    );
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE e.status <> 'pending'),
    count(*) FILTER (
      WHERE e.status = 'pending'
        AND (
          p.paypal_payout_email IS NULL
          OR trim(p.paypal_payout_email) = ''
          OR p.archived = true
          OR p.deactivated = true
          OR e.instructor_amount <= 0
        )
    )
  INTO v_attempted_count, v_moved_count, v_blocked_count
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  JOIN profiles p ON p.id = e.instructor_id
  WHERE a.payout_batch_id = p_source_batch_id;

  IF v_attempted_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_attempt_history');
  END IF;

  IF v_moved_count > 0 OR v_blocked_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_changed',
      'attempted', v_attempted_count,
      'moved', v_moved_count,
      'blocked', v_blocked_count
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.retry_payout_eligible;

  CREATE TEMP TABLE retry_payout_eligible ON COMMIT DROP AS
  SELECT
    e.id AS earning_id,
    e.instructor_id,
    e.instructor_amount,
    lower(trim(p.paypal_payout_email)) AS recipient_email
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  JOIN profiles p ON p.id = e.instructor_id
  WHERE a.payout_batch_id = p_source_batch_id
    AND e.status = 'pending'
    AND e.instructor_amount > 0
    AND p.paypal_payout_email IS NOT NULL
    AND trim(p.paypal_payout_email) <> ''
    AND p.deactivated = false
    AND p.archived = false
  FOR UPDATE OF e SKIP LOCKED;

  SELECT count(*) INTO v_available_count FROM retry_payout_eligible;

  -- A row lost to SKIP LOCKED means a concurrent payout is touching it.
  IF v_available_count <> v_attempted_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_locked',
      'attempted', v_attempted_count,
      'available', v_available_count
    );
  END IF;

  SELECT
    coalesce(round(sum(instructor_amount)::numeric, 2), 0),
    count(DISTINCT instructor_id)
  INTO v_total, v_item_count
  FROM retry_payout_eligible;

  v_sender_batch_id := 'shcpr-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO instructor_payout_batches (
    created_by,
    status,
    sender_batch_id,
    total_amount,
    item_count,
    retry_of_batch_id
  )
  VALUES (
    p_actor_id,
    'pending',
    v_sender_batch_id,
    v_total,
    v_item_count,
    p_source_batch_id
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
  FROM retry_payout_eligible
  GROUP BY instructor_id, recipient_email;

  UPDATE instructor_earnings e
  SET
    status = 'payout_pending',
    payout_batch_id = v_batch_id,
    payout_item_id = i.id,
    updated_at = now()
  FROM retry_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  WHERE e.id = eligible.earning_id;

  INSERT INTO instructor_payout_attempts (
    earning_id,
    payout_batch_id,
    payout_item_id,
    instructor_id,
    amount,
    outcome,
    note
  )
  SELECT
    eligible.earning_id,
    v_batch_id,
    i.id,
    eligible.instructor_id,
    eligible.instructor_amount,
    'reserved',
    'Retry of batch ' || p_source_batch_id::text
  FROM retry_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  ON CONFLICT (earning_id, payout_batch_id) DO NOTHING;

  SELECT jsonb_build_object(
    'success', true,
    'batch', jsonb_build_object(
      'id', b.id,
      'sender_batch_id', b.sender_batch_id,
      'total_amount', b.total_amount,
      'item_count', b.item_count,
      'retry_of_batch_id', b.retry_of_batch_id
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
  GROUP BY b.id, b.sender_batch_id, b.total_amount, b.item_count, b.retry_of_batch_id;

  RETURN v_result;
END;
$$;

-- Supabase exposes every public-schema function over /rest/v1/rpc/<name>.
-- Both reservation functions move money and must only be reachable from
-- server-side routes using the service-role client (see migration 0045).
REVOKE EXECUTE ON FUNCTION public.reserve_instructor_payout_batch(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reserve_payout_retry_batch(uuid, uuid)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_instructor_payout_batch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_payout_retry_batch(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Hourly payout reconciliation cron
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Until now, discovering a denial required a super_admin to remember to click
-- "Sync status". PayPal denials typically land within minutes to a few hours,
-- so an hourly reconciliation closes that gap without anyone watching.
--
-- Requires pg_cron + pg_net (already enabled by migration 0021) and the
-- system_settings rows 'app_url' and 'cron_secret'.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('reconcile-instructor-payouts')
where exists (
  select 1 from cron.job where jobname = 'reconcile-instructor-payouts'
);

select cron.schedule(
  'reconcile-instructor-payouts',
  '15 * * * *',   -- hourly at :15, offset from the 05:00 payout-create job
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/payouts/sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
