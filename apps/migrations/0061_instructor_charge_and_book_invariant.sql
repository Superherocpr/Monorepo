-- Migration: 0061_instructor_charge_and_book_invariant
--
-- Adds check #13 to public.health_invariants(): instructor-created bookings
-- with no completed payment.
--
-- WHY THIS EXISTS
--   Instructors can now add a student to their own class from the session page,
--   but only by charging a card — /api/sessions/[id]/charge-and-book creates the
--   booking in the same request as the PayPal capture and refunds the capture if
--   the booking step fails. That is the whole guarantee of the feature, and it
--   is invisible: a regression that let an unpaid booking through would look
--   exactly like a normal roster entry.
--
--   Existing check #2 does not cover it. That check is scoped to
--   booking_source = 'online', while these bookings are written as 'manual' —
--   the same source managers use for deliberately unpaid comp bookings. The new
--   check keys on the creator's ROLE instead, which is what actually separates
--   "must have been paid" from "may legitimately be free".
--
--   Everything else in the function is reproduced verbatim from migration 0056;
--   `create or replace` requires the whole body.
--
-- CONSUMED BY
--   lib/health-invariants.ts → /api/admin/daily-summary (0053 cron, production).
--   No application change is needed: the digest iterates whatever rows the
--   function returns.

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
  --    Overbooking corrupts the roster the instructor teaches from.
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
  --    Free promo bookings are NOT false positives: confirm-free writes a $0
  --    payment row with status 'completed', so a missing row means that insert
  --    failed. Invoice-backed and team bookings are excluded — they settle
  --    through a different path. 1h grace covers in-flight capture.
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

  -- 3. Completed online payments not attached to a booking. Money received with
  --    nothing delivered. Cash/check/invoice/promo types legitimately stand
  --    alone, so only 'online' is checked.
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

  -- 4. Certifications with no expiry. These silently drop out of the
  --    cert-expiry-reminder cron (0051), so the customer is never told to renew.
  select
    'cert_missing_expiry',
    'critical',
    count(*),
    'Certifications with a null expires_at'
  from certifications
  where expires_at is null

  union all

  -- 5. Payout batch header total disagreeing with the sum of its items.
  --    Automates part of the monthly manual reconciliation task.
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
  --
  --    Scoped to status = 'completed' only. Denied and cancelled batches
  --    legitimately carry a non-zero paypal_fee_total against all-zero item
  --    fees: reconcileBatch writes PayPal's batch-header fee whenever PayPal
  --    reports one (lib/payout-reconcile.ts), but the items were returned, so
  --    their per-item fees come back 0.00. There is nothing to reconcile on a
  --    batch whose funds went back to the business account.
  --
  --    This was found the hard way — the unscoped version flagged all four
  --    denied batches on production, and because denied is a terminal state it
  --    would have flagged them every single day forever. A warning that never
  --    clears is worse than no warning: it teaches people to skim past the
  --    health banner.
  --
  --    'assumed_complete' is also excluded — fees are not final until PayPal
  --    confirms. NULL item fees mean "not yet reconciled", a normal transient.
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

  -- 8. Company-paid team booking carrying no invoice. 0055 has no admin surface
  --    at all, so this check is currently the only thing that would ever notice.
  --
  --    Two distinct causes, both of which today emit only a console.error:
  --      a) createTeamInvoice failed outright — logged "invoice creation failed
  --         (non-fatal)". The company is simply never billed.
  --      b) The invoice was created but the writeback to team_bookings.invoice_id
  --         failed — logged "CRITICAL: failed to link invoice to team booking".
  --         Per that code comment this then makes mark_invoice_paid insert
  --         placeholder bookings and double the session headcount (cf. THREAT-059).
  --
  --    per_seat bookings are deliberately excluded: employees pay individually,
  --    so a null invoice_id is the correct steady state for them, and an unused
  --    share link is not corruption. 1h grace for the async invoice step.
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

  -- 9. Invoice status and paid_at disagreeing in either direction. A paid
  --    invoice with no timestamp breaks revenue reporting; an unpaid invoice
  --    carrying one means a state transition half-applied.
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

  -- 12. PayPal payouts webhook gone silent. Scoped to "a batch was actually
  --     submitted recently", so a quiet week produces no alert — only a batch
  --     that moved with no corresponding inbound event does. This is the sole
  --     check covering an inbound integration, whose failure mode is silence.
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
  --     Instructors may only add a student by charging a card
  --     (/api/sessions/[id]/charge-and-book creates the booking inside the same
  --     request as the capture, and refunds if the booking step fails), so an
  --     unpaid booking created by an instructor means that guarantee has been
  --     bypassed or a payment insert failed silently.
  --
  --     Manual bookings created by a manager or super admin are NOT breaches:
  --     /api/customers/[id]/add-booking deliberately books without payment.
  --     The check therefore keys on the creator's role, not the booking source.
  --     1h grace covers an in-flight capture.
  --
  --     DATE FLOOR: only bookings created on or after the feature shipped
  --     (2026-08-22) can be judged by its guarantee. Before that date no
  --     instructor could create a paid booking at all, so an unpaid one is not
  --     evidence of anything — staging carries 20 such rows from July seed
  --     scripts ("Mock class for testing"), and production carries none.
  --     Without this floor the check would sit permanently red on staging,
  --     which is the exact failure mode check #6 above was scoped to avoid:
  --     an alert that never clears teaches people to skim past the banner.
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

$$;

comment on function public.health_invariants() is
  'Data-consistency canary. Returns every check with its breach count (0 = healthy) '
  'so the caller can distinguish "all clear" from "canary did not run". '
  'Consumed by /api/admin/daily-summary.';

-- ── Lock down execute ────────────────────────────────────────────────────────
-- create or replace resets nothing about grants, but the revokes are repeated
-- so this file stands alone if replayed into a fresh database. PUBLIC carries
-- the default EXECUTE grant; revoking from anon/authenticated without first
-- revoking from PUBLIC is a silent no-op.
revoke all on function public.health_invariants() from public;
revoke all on function public.health_invariants() from anon;
revoke all on function public.health_invariants() from authenticated;
grant execute on function public.health_invariants() to service_role;

-- Check 13 probes bookings by creator; the partial index keeps that cheap
-- without duplicating idx_bookings_active_session.
create index if not exists idx_bookings_created_by_active
  on bookings (created_by) where cancelled = false and created_by is not null;
