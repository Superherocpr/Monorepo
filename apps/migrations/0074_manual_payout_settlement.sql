-- Migration 0074: Manual payout settlement
--
-- Background: PayPal has been denying payout batches with no stated reason, and
-- support cannot explain why. Instructors are being paid by hand instead (Zelle,
-- check, a personal PayPal transfer, ...). The app had no way to record that: the
-- earnings stayed `pending` after PayPal's denial released them, so the next
-- "Send Payouts" run would have paid the same instructor a second time.
--
-- This migration lets a super_admin settle a denied/failed payout ITEM by hand:
--   1. New `manually_paid` status on items and batches, and a `manually_paid`
--      attempt outcome, so the history stays honest ("PayPal denied it, then it
--      was paid manually").
--   2. Manual-payment columns on instructor_payout_items: method, reference,
--      date, note, who recorded it, and (if undone) who voided it and why.
--   3. record_manual_payout_item()  - atomic settle, mirrors the reserve_* RPCs.
--   4. void_manual_payout_item()    - undo a settlement made by mistake.
--   5. Two health invariants (checks 15 and 16) on public.health_invariants().
--
-- Deliberately NOT in scope:
--   * Items in `needs_review` (outcome unknown) or `unclaimed` / in flight at
--     PayPal. PayPal could still deliver those, so settling them by hand could
--     double-pay. needs_review goes through Release first; the others must wait
--     for PayPal to resolve them.
--   * Real PayPal fees. A manual payment has no PayPal payout fee, so
--     paypal_fee_amount stays NULL ("not tracked"), consistent with migration 0048.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Status vocabulary
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE instructor_payout_batches
  DROP CONSTRAINT IF EXISTS instructor_payout_batches_status_check;
ALTER TABLE instructor_payout_batches
  ADD CONSTRAINT instructor_payout_batches_status_check
    CHECK (status IN (
      'pending', 'assumed_complete', 'completed', 'denied', 'failed',
      'needs_review', 'manually_paid'
    ));

ALTER TABLE instructor_payout_items
  DROP CONSTRAINT IF EXISTS instructor_payout_items_status_check;
ALTER TABLE instructor_payout_items
  ADD CONSTRAINT instructor_payout_items_status_check
    CHECK (status IN (
      'pending', 'assumed_complete', 'completed', 'denied', 'failed',
      'needs_review', 'unclaimed', 'manually_paid'
    ));

ALTER TABLE instructor_payout_attempts
  DROP CONSTRAINT IF EXISTS instructor_payout_attempts_outcome_check;
ALTER TABLE instructor_payout_attempts
  ADD CONSTRAINT instructor_payout_attempts_outcome_check
    CHECK (outcome IN (
      'reserved', 'submitted', 'completed', 'denied', 'failed',
      'needs_review', 'unclaimed', 'manually_paid'
    ));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Manual payment record
-- ═══════════════════════════════════════════════════════════════════════════
--
-- manual_prior_status remembers whether the item was `denied` or `failed` so an
-- undo can put it back exactly as it was.

ALTER TABLE instructor_payout_items
  ADD COLUMN IF NOT EXISTS manual_method text,
  ADD COLUMN IF NOT EXISTS manual_reference text,
  ADD COLUMN IF NOT EXISTS manual_paid_on date,
  ADD COLUMN IF NOT EXISTS manual_note text,
  ADD COLUMN IF NOT EXISTS manual_prior_status text,
  ADD COLUMN IF NOT EXISTS manual_recorded_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS manual_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_voided_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS manual_voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_void_reason text;

ALTER TABLE instructor_payout_items
  DROP CONSTRAINT IF EXISTS instructor_payout_items_manual_method_check;
ALTER TABLE instructor_payout_items
  ADD CONSTRAINT instructor_payout_items_manual_method_check
    CHECK (manual_method IS NULL OR manual_method IN (
      'zelle', 'check', 'cash', 'paypal_personal', 'venmo', 'bank_transfer', 'other'
    ));

-- A manually_paid item without its record is the failure this guards against:
-- the earnings would read as paid with nothing to say who paid them or how.
ALTER TABLE instructor_payout_items
  DROP CONSTRAINT IF EXISTS instructor_payout_items_manual_record_check;
ALTER TABLE instructor_payout_items
  ADD CONSTRAINT instructor_payout_items_manual_record_check
    CHECK (
      status <> 'manually_paid'
      OR (
        manual_method IS NOT NULL
        AND manual_reference IS NOT NULL
        AND manual_paid_on IS NOT NULL
        AND manual_recorded_by IS NOT NULL
        AND manual_recorded_at IS NOT NULL
      )
    );

COMMENT ON COLUMN instructor_payout_items.manual_method IS
  'How the instructor was paid outside PayPal. Set only by record_manual_payout_item().';
COMMENT ON COLUMN instructor_payout_items.manual_prior_status IS
  'denied or failed: the status this item had before it was settled by hand, restored on undo.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Batch status recompute (internal helper)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mirrors writeBatchStatus() in lib/payout-reconcile.ts for the cases manual
-- settlement can reach. Only ever moves a batch between denied / failed (all
-- items returned), completed (some paid, some returned, or all paid), and
-- manually_paid (every item paid by hand). Anything still open at PayPal
-- (pending, assumed_complete, unclaimed, needs_review) leaves the status alone.
--
-- Not callable by clients: only the two RPCs below invoke it.

CREATE OR REPLACE FUNCTION recompute_payout_batch_after_manual(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_open int;
  v_returned int;
  v_failed int;
  v_completed int;
  v_manual int;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('pending', 'assumed_complete', 'unclaimed', 'needs_review')),
    count(*) FILTER (WHERE status IN ('denied', 'failed')),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'manually_paid')
  INTO v_total, v_open, v_returned, v_failed, v_completed, v_manual
  FROM instructor_payout_items
  WHERE payout_batch_id = p_batch_id;

  IF v_open > 0 THEN
    RETURN;
  END IF;

  IF v_returned = 0 THEN
    -- Everything is paid, by PayPal and/or by hand.
    UPDATE instructor_payout_batches
    SET status = CASE WHEN v_manual > 0 AND v_completed = 0 THEN 'manually_paid' ELSE 'completed' END,
        error_message = NULL,
        completed_at = coalesce(completed_at, now())
    WHERE id = p_batch_id;
  ELSIF v_completed + v_manual = 0 THEN
    -- An undo left every item returned again. A batch whose items all failed
    -- never reached PayPal, so it goes back to `failed`, not `denied`.
    UPDATE instructor_payout_batches
    SET status = CASE WHEN v_failed = v_returned THEN 'failed' ELSE 'denied' END,
        error_message = CASE
          WHEN v_failed = v_returned THEN error_message
          ELSE 'Every payout item in this batch was returned by PayPal.'
        END,
        completed_at = NULL
    WHERE id = p_batch_id;
  ELSE
    -- Some paid, some returned. The batch is finished; the returned earnings
    -- flow into the next normal payout run.
    UPDATE instructor_payout_batches
    SET status = 'completed',
        error_message = v_returned::text || ' of ' || v_total::text
          || ' payout items were returned by PayPal and have been re-queued.',
        completed_at = coalesce(completed_at, now())
    WHERE id = p_batch_id;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. record_manual_payout_item - settle one instructor's returned payout by hand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Atomic, so a double click or a concurrent "Send Payouts" cannot pay the same
-- earning twice. Refuses (returns a reason, never raises) unless:
--   * the item is `denied` or `failed` - the only states where the money is
--     certainly back with the business and nothing is still moving at PayPal;
--   * every earning in the item's attempt history is still `pending` - one that
--     was paid, or swept into a newer batch, means settling would double-pay;
--   * the amount typed matches both the item and its earnings, so a short or
--     over payment cannot be recorded by accident.

CREATE OR REPLACE FUNCTION record_manual_payout_item(
  p_actor_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_amount numeric,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_status text;
  v_item_amount numeric(10,2);
  v_instructor_id uuid;
  v_attempted_count int;
  v_not_pending_count int;
  v_available_count int;
  v_earnings_total numeric(10,2);
  v_note text;
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

  IF coalesce(trim(p_reference), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reference_required');
  END IF;

  IF p_paid_on IS NULL OR p_paid_on > current_date + 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_paid_on');
  END IF;

  -- Lock the item first so two settlements of the same item serialise.
  SELECT status, amount, instructor_id
  INTO v_item_status, v_item_amount, v_instructor_id
  FROM instructor_payout_items
  WHERE id = p_item_id
    AND payout_batch_id = p_batch_id
  FOR UPDATE;

  IF v_item_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_not_found');
  END IF;

  IF v_item_status = 'manually_paid' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_manually_paid');
  END IF;

  IF v_item_status NOT IN ('denied', 'failed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'item_not_settleable',
      'status', v_item_status
    );
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE e.status <> 'pending')
  INTO v_attempted_count, v_not_pending_count
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  WHERE a.payout_batch_id = p_batch_id
    AND a.payout_item_id = p_item_id;

  IF v_attempted_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_attempt_history');
  END IF;

  IF v_not_pending_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_changed',
      'attempted', v_attempted_count,
      'moved', v_not_pending_count
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.manual_payout_eligible;

  CREATE TEMP TABLE manual_payout_eligible ON COMMIT DROP AS
  SELECT e.id AS earning_id, e.instructor_amount
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  WHERE a.payout_batch_id = p_batch_id
    AND a.payout_item_id = p_item_id
    AND e.status = 'pending'
    AND e.instructor_id = v_instructor_id
  FOR UPDATE OF e SKIP LOCKED;

  SELECT count(*), coalesce(round(sum(instructor_amount)::numeric, 2), 0)
  INTO v_available_count, v_earnings_total
  FROM manual_payout_eligible;

  -- A row lost to SKIP LOCKED means a concurrent payout is touching it.
  IF v_available_count <> v_attempted_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_locked',
      'attempted', v_attempted_count,
      'available', v_available_count
    );
  END IF;

  IF v_earnings_total <> v_item_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'item_total_mismatch',
      'item_amount', v_item_amount,
      'earnings_total', v_earnings_total
    );
  END IF;

  IF p_amount IS NULL OR round(p_amount, 2) <> v_item_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'amount_mismatch',
      'expected', v_item_amount
    );
  END IF;

  UPDATE instructor_earnings e
  SET
    status = 'paid',
    payout_batch_id = p_batch_id,
    payout_item_id = p_item_id,
    updated_at = now()
  FROM manual_payout_eligible eligible
  WHERE e.id = eligible.earning_id;

  v_note := 'Paid manually via ' || p_method || ' on ' || p_paid_on::text
    || ' (ref ' || trim(p_reference) || ')';

  UPDATE instructor_payout_attempts
  SET
    outcome = 'manually_paid',
    resolved_at = now(),
    note = v_note
  WHERE payout_batch_id = p_batch_id
    AND payout_item_id = p_item_id;

  -- error_message is cleared because the PayPal failure text no longer describes
  -- the item; the denied_* columns keep the audit trail of what PayPal did.
  UPDATE instructor_payout_items
  SET
    status = 'manually_paid',
    manual_prior_status = v_item_status,
    manual_method = p_method,
    manual_reference = trim(p_reference),
    manual_paid_on = p_paid_on,
    manual_note = nullif(trim(coalesce(p_note, '')), ''),
    manual_recorded_by = p_actor_id,
    manual_recorded_at = now(),
    manual_voided_by = NULL,
    manual_voided_at = NULL,
    manual_void_reason = NULL,
    error_message = NULL,
    updated_at = now()
  WHERE id = p_item_id;

  PERFORM recompute_payout_batch_after_manual(p_batch_id);

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'instructor_id', v_instructor_id,
    'amount', v_item_amount,
    'earnings_settled', v_available_count
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. void_manual_payout_item - undo a manual settlement made by mistake
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Puts the earnings back to `pending` and the item back to the denied/failed
-- state it had. The manual_* record stays on the row, stamped as voided, so the
-- original claim is still visible; the attempt note keeps the same history for
-- each earning. Only ever touches earnings this item settled.

CREATE OR REPLACE FUNCTION void_manual_payout_item(
  p_actor_id uuid,
  p_item_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_status text;
  v_prior_status text;
  v_batch_id uuid;
  v_method text;
  v_reference text;
  v_released int;
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

  IF coalesce(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reason_required');
  END IF;

  SELECT status, manual_prior_status, payout_batch_id, manual_method, manual_reference
  INTO v_item_status, v_prior_status, v_batch_id, v_method, v_reference
  FROM instructor_payout_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF v_item_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_not_found');
  END IF;

  IF v_item_status <> 'manually_paid' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'not_manually_paid',
      'status', v_item_status
    );
  END IF;

  WITH released AS (
    UPDATE instructor_earnings
    SET
      status = 'pending',
      payout_batch_id = NULL,
      payout_item_id = NULL,
      updated_at = now()
    WHERE payout_item_id = p_item_id
      AND status = 'paid'
    RETURNING id
  )
  SELECT count(*) INTO v_released FROM released;

  UPDATE instructor_payout_attempts
  SET
    outcome = CASE WHEN v_prior_status = 'failed' THEN 'failed' ELSE 'denied' END,
    resolved_at = now(),
    note = 'Manual payment via ' || coalesce(v_method, '?') || ' (ref '
      || coalesce(v_reference, '?') || ') voided: ' || trim(p_reason)
  WHERE payout_batch_id = v_batch_id
    AND payout_item_id = p_item_id
    AND outcome = 'manually_paid';

  UPDATE instructor_payout_items
  SET
    status = CASE WHEN v_prior_status = 'failed' THEN 'failed' ELSE 'denied' END,
    manual_voided_by = p_actor_id,
    manual_voided_at = now(),
    manual_void_reason = trim(p_reason),
    updated_at = now()
  WHERE id = p_item_id;

  PERFORM recompute_payout_batch_after_manual(v_batch_id);

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'earnings_released', v_released
  );
END;
$$;

-- Supabase exposes every public-schema function over /rest/v1/rpc/<name>. These
-- move money records and must only be reachable from server routes using the
-- service-role client. PUBLIC carries the default EXECUTE grant; revoking from
-- anon/authenticated alone is a silent no-op (see migration 0049).
REVOKE ALL ON FUNCTION public.record_manual_payout_item(uuid, uuid, uuid, text, text, date, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_manual_payout_item(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_payout_batch_after_manual(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_manual_payout_item(uuid, uuid, uuid, text, text, date, numeric, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.void_manual_payout_item(uuid, uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Health invariants 15 and 16
-- ═══════════════════════════════════════════════════════════════════════════
--
--   15. A `paid` earning whose payout item is neither `completed` nor
--       `manually_paid`. That means money is recorded as paid against an item
--       that says it was returned. Reconciliation overwriting a manual
--       settlement, or a PayPal reversal after delivery, both land here.
--   16. A `manually_paid` item whose settled earnings do not sum to its amount.
--       Catches a partial or half-applied settlement.
--
-- Everything else in the function is reproduced verbatim from migration 0065;
-- `create or replace` requires the whole body.

create or replace function public.health_invariants()
returns table (
  check_name    text,
  severity      text,
  breach_count  bigint,
  detail        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$

  -- 1. Sessions holding more confirmed bookings than they have seats.
  select
    'session_over_capacity',
    'critical',
    count(*),
    'Sessions with more non-cancelled bookings than max_capacity'
  from (
    select s.id
    from class_sessions s
    join bookings b on b.session_id = s.id and b.cancelled = false
    where s.status <> 'cancelled'
    group by s.id, s.max_capacity
    having count(b.id) > s.max_capacity
  ) over_capacity

  union all

  -- 2. Online bookings with no completed payment of any kind.
  select
    'booking_missing_payment',
    'critical',
    count(*),
    'Online bookings >1h old with no completed payment row'
  from bookings b
  where b.cancelled = false
    and b.booking_source = 'online'
    and b.invoice_id is null
    and b.team_booking_id is null
    and b.created_at < now() - interval '1 hour'
    and not exists (
      select 1 from payments p
      where p.booking_id = b.id and p.status = 'completed'
    )

  union all

  -- 3. Completed online payments not attached to a booking.
  select
    'payment_orphan_no_booking',
    'critical',
    count(*),
    'Completed online payments with no booking_id'
  from payments p
  where p.status = 'completed'
    and p.payment_type = 'online'
    and p.booking_id is null
    and p.created_at < now() - interval '1 hour'

  union all

  -- 4. Certifications with no expiry.
  select
    'cert_missing_expiry',
    'critical',
    count(*),
    'Certifications with a null expires_at'
  from certifications
  where expires_at is null

  union all

  -- 5. Payout batch header total disagreeing with the sum of its items.
  select
    'payout_batch_total_mismatch',
    'critical',
    count(*),
    'Batches where total_amount <> sum(item amounts)'
  from (
    select b.id
    from instructor_payout_batches b
    join instructor_payout_items i on i.payout_batch_id = b.id
    group by b.id, b.total_amount
    having coalesce(b.total_amount, 0) <> coalesce(sum(i.amount), 0)
  ) mismatched

  union all

  -- 6. Batch-level PayPal fee disagreeing with the sum of per-item fees.
  select
    'payout_fee_total_mismatch',
    'warning',
    count(*),
    'Completed batches where paypal_fee_total <> sum(item fees)'
  from (
    select b.id
    from instructor_payout_batches b
    join instructor_payout_items i on i.payout_batch_id = b.id
    where b.paypal_fee_total is not null
      and b.status = 'completed'
    group by b.id, b.paypal_fee_total
    having count(*) filter (where i.paypal_fee_amount is null) = 0
       and b.paypal_fee_total <> coalesce(sum(i.paypal_fee_amount), 0)
  ) fee_mismatched

  union all

  -- 7. Earnings pointing at a payout batch that no longer exists.
  select
    'earnings_orphan_batch',
    'critical',
    count(*),
    'instructor_earnings referencing a missing payout batch'
  from instructor_earnings e
  where e.payout_batch_id is not null
    and not exists (
      select 1 from instructor_payout_batches b where b.id = e.payout_batch_id
    )

  union all

  -- 8. Company-paid team booking carrying no invoice.
  select
    'team_booking_company_no_invoice',
    'critical',
    count(*),
    'Company-paid team bookings >1h old with no linked invoice'
  from team_bookings t
  where t.payment_mode = 'company'
    and t.invoice_id is null
    and t.created_at < now() - interval '1 hour'

  union all

  -- 9. Invoice status and paid_at disagreeing in either direction.
  select
    'invoice_paid_state_mismatch',
    'critical',
    count(*),
    'Invoices where status=paid XOR paid_at is set'
  from invoices
  where (status = 'paid' and paid_at is null)
     or (status <> 'paid' and paid_at is not null)

  union all

  -- 10. Cancelled invoices with no cancellation timestamp.
  select
    'invoice_cancelled_no_timestamp',
    'warning',
    count(*),
    'Invoices with status=cancelled and no cancelled_at'
  from invoices
  where status = 'cancelled' and cancelled_at is null

  union all

  -- 11. Bookings attached to a session that no longer exists.
  select
    'booking_orphan_session',
    'critical',
    count(*),
    'Non-cancelled bookings referencing a missing session'
  from bookings b
  where b.cancelled = false
    and not exists (select 1 from class_sessions s where s.id = b.session_id)

  union all

  -- 12. PayPal payouts webhook gone silent.
  select
    'payout_webhook_silent',
    'warning',
    count(*),
    'Batches submitted >6h ago with no webhook event received since'
  from instructor_payout_batches b
  where b.submitted_at is not null
    and b.submitted_at > now() - interval '7 days'
    and b.submitted_at < now() - interval '6 hours'
    and not exists (
      select 1 from processed_webhook_events w
      where w.received_at >= b.submitted_at
        and w.event_type like 'PAYMENT.PAYOUTS%'
    )

  union all

  -- 13. Instructor-added students with no completed payment.
  select
    'instructor_booking_missing_payment',
    'critical',
    count(*),
    'Instructor-created bookings >1h old (since 2026-08-22) with no completed payment row'
  from bookings b
  join profiles p on p.id = b.created_by
  where b.cancelled = false
    and p.role = 'instructor'
    and b.invoice_id is null
    and b.created_at >= date '2026-08-22'
    and b.created_at < now() - interval '1 hour'
    and not exists (
      select 1 from payments pay
      where pay.booking_id = b.id and pay.status = 'completed'
    )

  union all

  -- 14. Contact email and login email out of sync for the same account.
  --     Written by two routes (profile/self-update, staff/[id]/update); both
  --     roll back on partial failure, and this is what proves that held.
  --     Case-insensitive because auth stores addresses lowercased.
  select
    'profile_auth_email_mismatch',
    'critical',
    count(*),
    'Accounts where profiles.email disagrees with auth.users.email'
  from profiles p
  join auth.users u on u.id = p.id
  where lower(coalesce(p.email, '')) is distinct from lower(coalesce(u.email, ''))

  union all

  -- 15. Earnings recorded as paid against a payout item that was not paid.
  --     The only legitimate item statuses behind a `paid` earning are
  --     completed (PayPal confirmed) and manually_paid (settled by hand).
  select
    'paid_earning_item_not_paid',
    'critical',
    count(*),
    'Earnings with status=paid whose payout item is neither completed nor manually_paid'
  from instructor_earnings e
  join instructor_payout_items i on i.id = e.payout_item_id
  where e.status = 'paid'
    and i.status not in ('completed', 'manually_paid')

  union all

  -- 16. Manually settled items whose paid earnings do not add up to the item.
  select
    'manual_payout_amount_mismatch',
    'critical',
    count(*),
    'manually_paid payout items where paid earnings <> item amount'
  from (
    select i.id
    from instructor_payout_items i
    left join instructor_earnings e
      on e.payout_item_id = i.id and e.status = 'paid'
    where i.status = 'manually_paid'
    group by i.id, i.amount
    having coalesce(sum(e.instructor_amount), 0) <> i.amount
  ) manual_mismatched

$$;

comment on function public.health_invariants() is
  'Data-consistency canary. Returns every check with its breach count (0 = healthy) '
  'so the caller can distinguish "all clear" from "canary did not run". '
  'Consumed by /api/admin/daily-summary.';

revoke all on function public.health_invariants() from public;
revoke all on function public.health_invariants() from anon;
revoke all on function public.health_invariants() from authenticated;
grant execute on function public.health_invariants() to service_role;
