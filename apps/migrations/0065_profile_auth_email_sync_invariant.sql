-- Migration: 0065_profile_auth_email_sync_invariant
--
-- Adds check #14 to public.health_invariants(): profiles.email disagreeing with
-- auth.users.email for the same account.
--
-- WHY THIS EXISTS
--   Staff can now change their own login email from the Account tab on
--   /admin/settings (PATCH /api/profile/self-update), joining the existing
--   super-admin path (PATCH /api/staff/[id]/update). Both write the address to
--   TWO places — public.profiles.email and auth.users.email — because the site
--   treats the contact address and the login address as one value.
--
--   Both routes roll the profiles write back if the auth write fails, but that
--   rollback is itself code that can regress, and the failure is invisible:
--   the user keeps signing in with the old address while /book and every
--   confirmation email show the new one (they read profiles). Nothing in the
--   app would ever surface that split.
--
--   This check is the only thing that would notice.
--
--   Fully qualifies auth.users because the function pins
--   search_path = public, pg_temp. SECURITY DEFINER (owner: postgres) is what
--   allows the read.
--
--   Everything else in the function is reproduced verbatim from migration 0061;
--   `create or replace` requires the whole body.
--
-- KNOWN STATE AT WRITE TIME
--   production: 0 breaches. staging: 1 — a test customer row whose profile and
--   auth addresses were deliberately set to different mailboxes during earlier
--   manual testing. Not a code defect; clear it by aligning that row when
--   convenient and the check goes green.
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
