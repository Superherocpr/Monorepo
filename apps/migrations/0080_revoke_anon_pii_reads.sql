-- Migration: 0080_revoke_anon_pii_reads
--
-- Removes three row-level-security policies that let anyone holding the site's
-- public API key read personal data, and adds check #17 to public.health_invariants()
-- so a policy like that can never come back unnoticed.
--
-- WHY THIS EXISTS
--   Found in a 2026-10-28 security review. The public (anon) API key ships in
--   the website's JavaScript by design, so any visitor has it. Three policies
--   gave that key unrestricted SELECT:
--
--     profiles_anon_email_exists_check      ON profiles        USING (true)
--     profiles_anon_read_lead_instructor    ON profiles        (lead instructor row)
--     roster_records_anon_read_by_session   ON roster_records  USING (true), anon + authenticated
--
--   RLS filters ROWS, not columns, and anon holds table-level SELECT on every
--   column. So `GET /rest/v1/profiles?select=*` returned every customer's and
--   staff member's phone, address, notes, role, daily rollcall access code and
--   PayPal payout email (production: 128 rows), and `roster_records` returned
--   every student's email, phone and address (93 rows). Confirmed over the real
--   REST API with a zero-row count request.
--
--   The policies were written in 0023 as a convenience for three code paths
--   (the booking page's duplicate-email check, the student roster-correction
--   page, and the lead instructor's name on two public pages). 0023's own
--   comments marked the profiles one as a TODO to remove.
--
-- DEPLOY ORDER MATTERS: APPLICATION CODE FIRST, THIS MIGRATION SECOND.
--   Dropping a SELECT policy does not make queries error; they silently return
--   zero rows. If this ran before the new code was live, the old booking page
--   would find no existing accounts (every returning customer would look new)
--   and the roster page would show an empty class. The replacement code reads
--   through the service-role client and is unaffected by these policies, so it
--   is safe to deploy before this migration and works the same after it.
--
-- WHAT THIS DOES NOT CHANGE
--   - profiles_auth_read_own / profiles_auth_update_own / profiles_anon_insert_own
--     stay: customers still read and edit only their own row and sign up.
--   - Public content stays public: class_sessions, class_types, cert_types,
--     products, locations and the blog policies are untouched.
--   - Table-level grants (anon still holds INSERT/UPDATE/DELETE/TRUNCATE on
--     every table, blocked only by RLS) are NOT touched here. Tightening those
--     is a separate hardening step.
--
-- IDEMPOTENT
--   DROP POLICY IF EXISTS, so it is safe on staging, production, or a replay.
--
-- HEALTH CHECK #17 (public_read_policy_on_pii_table)
--   Counts SELECT/ALL policies that let anon, authenticated or public read
--   every row of a table, other than a short allowlist of intentionally public
--   content tables, plus ANY anon/public-readable policy on profiles or
--   roster_records. Healthy = 0. Verified against both databases BEFORE this
--   migration: it reports exactly the three policies dropped below.
--   Adding a table to the allowlist is a deliberate act: edit the list in this
--   function and say why.
--
--   Everything else in the function is reproduced verbatim from migration 0075
--   (identical on staging and production when this was written, checked by
--   md5 of pg_get_functiondef); `create or replace` requires the whole body.

-- ── 1. Drop the open read policies ──────────────────────────────────────────

drop policy if exists "profiles_anon_email_exists_check" on public.profiles;
drop policy if exists "profiles_anon_read_lead_instructor" on public.profiles;
drop policy if exists "roster_records_anon_read_by_session" on public.roster_records;

-- ── 2. Health check #17 ─────────────────────────────────────────────────────

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

  union all

  -- 17. Open read policies on personal-data tables.
  --     A SELECT (or ALL) policy reachable by the public API key or any signed-in
  --     customer whose condition is simply `true` exposes every row, and RLS
  --     cannot limit columns. Intentionally public content tables are allowlisted;
  --     profiles and roster_records must have no anon/public-readable policy at
  --     all. Reads pg_policies (a catalog view), so it sees policies the moment
  --     they are created, in either database.
  select
    'public_read_policy_on_pii_table',
    'critical',
    count(*),
    'RLS policies letting anon/customers read every row of a personal-data table'
  from pg_policies
  where schemaname = 'public'
    and cmd in ('SELECT', 'ALL')
    and roles && array['anon', 'authenticated', 'public']::name[]
    and (
      (
        coalesce(qual, 'true') = 'true'
        and tablename not in (
          'blog_slug_redirects',
          'blog_tags',
          'locations',
          'product_variants',
          'social_feed_cache'
        )
      )
      or (
        tablename in ('profiles', 'roster_records')
        and roles && array['anon', 'public']::name[]
      )
    )


$$;

comment on function public.health_invariants() is
  'Data-consistency canary. Returns every check with its breach count (0 = healthy) '
  'so the caller can distinguish "all clear" from "canary did not run". '
  'Consumed by /api/admin/daily-summary.';

revoke all on function public.health_invariants() from public;
revoke all on function public.health_invariants() from anon;
revoke all on function public.health_invariants() from authenticated;
grant execute on function public.health_invariants() to service_role;
