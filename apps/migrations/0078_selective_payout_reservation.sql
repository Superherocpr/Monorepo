-- 0078: let an admin choose which earnings go into a payout batch
--
-- Until now reserve_instructor_payout_batch(p_actor_id) swept EVERY eligible
-- pending earning into one batch, so "Send Payouts" was all-or-nothing. The admin
-- now picks instructors and individual classes on /admin/payouts, and the route
-- passes the chosen earning ids here.
--
-- New optional parameter:
--   p_earning_ids uuid[]  DEFAULT NULL
--     NULL            -> every eligible earning (the old behaviour, still used by
--                        the immediate and scheduled automatic modes)
--     a list of ids   -> ONLY those earnings, and only if each is still eligible
--     an EMPTY list   -> nothing. It must never fall through to "everything".
--
-- Selection narrows the existing eligibility rules; it never widens them. A
-- requested earning that has since been paid, reserved by another batch, locked by
-- a concurrent run, or whose instructor lost a payout email is silently left out,
-- and the result reports requested_count vs reserved_count so the caller can say
-- so. Everything else (FOR UPDATE SKIP LOCKED, one item per instructor, attempt
-- rows) is unchanged from 0048.
--
-- Adding a parameter creates an OVERLOAD, and with a default it would make a call
-- that passes only p_actor_id ambiguous. So the old one-argument function is
-- dropped first. Both functions move money: execute stays service_role only, and
-- REVOKE ... FROM PUBLIC is required (revoking from anon/authenticated alone is a
-- silent no-op, see migration 0049).
--
-- Apply in the SQL editor: the Supabase MCP auto-declines DROP and REVOKE.

DROP FUNCTION IF EXISTS public.reserve_instructor_payout_batch(uuid);

CREATE OR REPLACE FUNCTION public.reserve_instructor_payout_batch(
  p_actor_id    uuid,
  p_earning_ids uuid[] DEFAULT NULL
)
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
  v_reserved_count int;
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
    -- NULL means "all"; an empty array matches nothing, never everything.
    AND (p_earning_ids IS NULL OR e.id = ANY(p_earning_ids))
  FOR UPDATE OF e SKIP LOCKED;

  SELECT
    coalesce(round(sum(instructor_amount)::numeric, 2), 0),
    count(DISTINCT instructor_id),
    count(*)
  INTO v_total, v_item_count, v_reserved_count
  FROM reserve_payout_eligible;

  IF v_item_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_eligible_earnings',
      'requested_count', CASE WHEN p_earning_ids IS NULL THEN NULL
                              ELSE cardinality(p_earning_ids) END
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
    'requested_count', CASE WHEN p_earning_ids IS NULL THEN NULL
                            ELSE cardinality(p_earning_ids) END,
    'reserved_count', v_reserved_count,
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

REVOKE ALL ON FUNCTION public.reserve_instructor_payout_batch(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_instructor_payout_batch(uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_instructor_payout_batch(uuid, uuid[]) TO service_role;
