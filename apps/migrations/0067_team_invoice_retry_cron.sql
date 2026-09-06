-- Migration: 0067_team_invoice_retry_cron
--
-- Closes the #1 open gap in Building/feature-health-map.md: company-paid team
-- bookings whose invoice never got raised.
--
-- BACKGROUND
--   createTeamBooking() raises the company invoice synchronously and treats a
--   failure as non-fatal — the class and share link must survive a PayPal
--   outage. Until now that failure produced a console line and nothing else:
--   team_bookings.invoice_id stayed null, the contact was told the class was
--   booked, and nobody was ever asked to pay. It happened twice — Acme Hospital
--   on staging (2026-08-19, $1,200) and Bradenton Bay High School in production
--   (2026-09-04, $1,020).
--
--   Migration 0056 added the `team_booking_company_no_invoice` invariant, which
--   DETECTS this but pages nobody: it only surfaces when someone runs the daily
--   maintenance checklist. That is how the production case sat unbilled.
--
-- WHAT THIS ADDS
--   A daily sweep that RETRIES invoice creation on every breaching booking and
--   emails super_admins about whatever is still uninvoiced afterwards — so the
--   common case self-heals and the uncommon case is loud (CLAUDE.md §6).
--
--   The root cause of both failures was fixed separately in the same task:
--   createBusinessPayPalInvoice() read `body.id` from PayPal's create-invoice
--   response, which only exists when the request sends
--   `Prefer: return=representation`. It did not, so every real invoice creation
--   silently found no id. No migration is needed for that part.
--
-- ⚠️  CRON STATUS AS OF 2026-09-05: NOT SCHEDULED IN EITHER ENVIRONMENT.
--
--   Sections 1 and 2 are applied to staging AND production. Section 3 was
--   applied and then deliberately unscheduled in both. Two separate reasons:
--
--   STAGING — PERMANENT EXCLUSION. Staging inherits the LIVE PayPal merchant
--     credentials from app-level Amplify env vars (THREAT-065), so a test
--     company booking with a future class date would have this sweep raise a
--     REAL invoice on the real merchant account. Never schedule it here. Same
--     spirit as migration 0053's staging exclusion. Staging still gets the admin
--     page and its manual retry button.
--
--   PRODUCTION — TEMPORARY, PENDING TWO THINGS:
--     1. The app code must be deployed first. Until it is, /api/admin/team-
--        bookings/retry-invoices 404s, which writes no heartbeat row and would
--        make cron_health() report the job overdue in the daily digest.
--     2. The Bradenton Bay booking (67abad1b-8aba-4d8b-92ee-8e926b95e7d9) must
--        be reconciled first. Its invoice already exists in PayPal as an UNSENT
--        DRAFT — created by the failed 2026-09-04 attempt, which is exactly the
--        bug this migration accompanies. Enabling the sweep before that booking
--        has its invoice_id set would raise a SECOND invoice for the same class.
--
--   TO ENABLE IN PRODUCTION once both are done, run section 3 of this file
--   against production only.
--
-- BEFORE RUNNING:
--   1. Enable pg_net  in the Supabase dashboard → Database → Extensions.
--   2. Enable pg_cron in the Supabase dashboard → Database → Extensions.
--   3. Ensure system_settings has rows for 'app_url' and 'cron_secret'
--      (inserted by migration 0007 / social feed cron setup).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. Index supporting the "which bookings need an invoice" query ──────────
-- Partial, because the sweep, the admin page, and the SQL invariant all ask the
-- same narrow question: company mode, invoice_id null, ordered by age.
create index if not exists idx_team_bookings_uninvoiced
  on public.team_bookings (created_at desc)
  where payment_mode = 'company' and invoice_id is null;

-- ── 2. Register with cron_health() expectations ─────────────────────────────
-- Without this row the job defaults to a 1500-minute gap, which is right for a
-- daily job, but the note is what tells a future reader why it exists.
insert into public.cron_job_expectations (job_name, max_gap_minutes, note)
values (
  'retry-team-booking-invoices',
  1500,
  'Daily 13:00 UTC — retries invoice creation for company-paid team bookings with no invoice, then emails super_admins whatever is still outstanding'
)
on conflict (job_name) do update
  set max_gap_minutes = excluded.max_gap_minutes,
      note            = excluded.note;

-- ── 3. Schedule ─────────────────────────────────────────────────────────────
-- 13:00 UTC (~8-9am Eastern) puts the alert in the inbox an hour before the
-- stuck-payout digest at 14:00, so the two do not arrive as one blur.
select cron.unschedule('retry-team-booking-invoices')
where exists (
  select 1 from cron.job where jobname = 'retry-team-booking-invoices'
);

select cron.schedule(
  'retry-team-booking-invoices',
  '0 13 * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/admin/team-bookings/retry-invoices',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
