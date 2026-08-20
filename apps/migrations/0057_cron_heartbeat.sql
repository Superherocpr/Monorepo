-- Migration: 0057_cron_heartbeat
--
-- Makes scheduled-job success observable, and fixes the timeout that was
-- silently failing them.
--
-- THE PROBLEM THIS SOLVES
--   Seven of the eight pg_cron jobs are fire-and-forget `net.http_post`.
--   `cron.job_run_details.status` records whether Postgres QUEUED the request,
--   not whether the endpoint did the work — so it reads 'succeeded' even when
--   the call never lands. On 2026-08-19 at 14:00 UTC the production
--   alert-stuck-payout-batches job timed out:
--
--     status_code: null, timed_out: true
--     "Timeout of 5000 ms reached. Total time: 5001.6 ms"
--
--   ...while cron.job_run_details reported it as succeeded. A p1 financial
--   safety net did not run and every monitoring surface said it was fine.
--
--   The real outcomes live in net._http_response, but that table SELF-PRUNES
--   after ~6 hours, so any daily or weekly polling check is structurally
--   incapable of ever seeing a failure. Observability has to be captured at the
--   time of the run, which is what cron_run_log does.
--
-- WHAT THIS MIGRATION DOES
--   1. cron_run_log          — durable per-run record, written by the endpoint
--                              itself once its work is actually complete.
--   2. cron_job_expectations — how long each job may go without reporting in.
--   3. public.cron_health()  — "has every job reported in within its window?"
--   4. Re-schedules all 7 HTTP jobs with timeout_milliseconds := 30000,
--      replacing pg_net's 5000ms default. None of them set it before, so all
--      seven were exposed to the failure above; the targets are Amplify SSR
--      Lambdas, where a cold start alone can approach 5s.
--   5. Wraps the one pure-SQL job so it reports in too.
--
-- WHY ROUTE-SIDE AND NOT DATABASE-SIDE
--   A longer pg_net timeout still can't prove the work finished — a slow but
--   successful run (the daily summary sends one email per admin) would record a
--   timeout while completing fine. Only the endpoint knows it finished, so the
--   endpoint is what writes the heartbeat. pg_net's response stays a secondary
--   signal.

-- ── 1. Durable run log ───────────────────────────────────────────────────────
create table if not exists public.cron_run_log (
  id              uuid primary key default gen_random_uuid(),
  job_name        text        not null,
  ran_at          timestamptz not null default now(),
  ok              boolean     not null,
  duration_ms     integer,
  -- Rows created/updated/emailed. Lets "ran but did nothing" be distinguished
  -- from "ran and worked", which a boolean alone cannot express.
  records_touched integer,
  error_message   text
);

create index if not exists idx_cron_run_log_job_ran_at
  on public.cron_run_log (job_name, ran_at desc);

alter table public.cron_run_log enable row level security;
-- No policies by design: written and read only via service_role, which bypasses
-- RLS. Enabling it without policies denies every anon/authenticated path.

comment on table public.cron_run_log is
  'Heartbeat written by each cron-invoked endpoint once its work completes. The authoritative record of whether a scheduled job ran — cron.job_run_details is not, for net.http_post jobs.';

-- ── 2. Per-job expectations ──────────────────────────────────────────────────
create table if not exists public.cron_job_expectations (
  job_name         text primary key,
  max_gap_minutes  integer not null,
  note             text
);

-- MUST be enabled. Supabase grants anon and authenticated full DML on every
-- table in `public` by default, so RLS is the only thing standing between an
-- unauthenticated caller and this data over PostgREST. Shipping this table
-- without it (fixed same day, see THREAT-061) left anon able to UPDATE
-- max_gap_minutes and silently disable overdue detection for every cron job.
alter table public.cron_job_expectations enable row level security;

comment on table public.cron_job_expectations is
  'How long each scheduled job may go without reporting in before cron_health() calls it overdue.';

insert into public.cron_job_expectations (job_name, max_gap_minutes, note) values
  ('reconcile-instructor-payouts',       120,  'Hourly at :15 — two missed runs is a problem'),
  ('notify-unclaimed-opportunities',     600,  '12x daily; largest scheduled gap is 05:00->13:00 UTC = 8h'),
  ('regenerate-instructor-access-codes', 1500, 'Daily 00:00 UTC — 25h allows one missed run before alerting'),
  ('refresh-social-feed-cache',          1500, 'Daily 03:00 UTC'),
  ('scheduled-instructor-payouts',       1500, 'Daily 05:00 UTC'),
  ('daily-ops-summary',                  1500, 'Daily 11:00 UTC — production only'),
  ('cert-expiry-reminders',              1500, 'Daily 13:00 UTC'),
  ('alert-stuck-payout-batches',         1500, 'Daily 14:00 UTC')
on conflict (job_name) do update
  set max_gap_minutes = excluded.max_gap_minutes,
      note            = excluded.note;

-- ── 3. Health check ──────────────────────────────────────────────────────────
--
-- The job list is derived from cron.job rather than hardcoded, so each
-- environment reports on exactly the jobs it actually has. That matters here:
-- daily-ops-summary is production-only by design, and a hardcoded list would
-- report it permanently overdue on staging.
--
-- A job that has NEVER reported in is returned with last_success = null and
-- is_overdue = true. That is the correct reading for a newly deployed heartbeat
-- as well as for a job that has genuinely never worked — both need a human.
create or replace function public.cron_health()
returns table (
  job_name       text,
  schedule       text,
  last_success   timestamptz,
  minutes_since  integer,
  max_gap_minutes integer,
  is_overdue     boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    j.jobname::text,
    j.schedule::text,
    l.last_success,
    case
      when l.last_success is null then null
      else (extract(epoch from (now() - l.last_success)) / 60)::integer
    end,
    coalesce(e.max_gap_minutes, 1500),
    l.last_success is null
      or l.last_success < now() - make_interval(mins => coalesce(e.max_gap_minutes, 1500))
  from cron.job j
  left join public.cron_job_expectations e
    on e.job_name = j.jobname
  left join lateral (
    select max(r.ran_at) as last_success
    from public.cron_run_log r
    where r.job_name = j.jobname and r.ok
  ) l on true
  where j.active
  order by j.jobname;
$$;

comment on function public.cron_health() is
  'Per-job heartbeat status. is_overdue = the job has not reported a successful run within its allowed gap. Job list comes from cron.job so each environment reports only its own jobs.';

revoke all on function public.cron_health() from public;
revoke all on function public.cron_health() from anon;
revoke all on function public.cron_health() from authenticated;
grant execute on function public.cron_health() to service_role;

-- ── 4. Retention ─────────────────────────────────────────────────────────────
-- ~45 rows/day across all jobs. 180 days keeps the table trivially small while
-- leaving enough history to spot a job that degrades gradually.
create or replace function public.prune_cron_run_log()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.cron_run_log where ran_at < now() - interval '180 days';
$$;

revoke all on function public.prune_cron_run_log() from public;
revoke all on function public.prune_cron_run_log() from anon;
revoke all on function public.prune_cron_run_log() from authenticated;

-- ── 5. Pure-SQL job reports in too ───────────────────────────────────────────
-- regenerate-instructor-access-codes is the one job where job_run_details IS
-- trustworthy (no HTTP hop), but it should still appear in cron_health()
-- alongside the others rather than being a special case a human must remember.
create or replace function public.regenerate_access_codes_logged()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  started timestamptz := clock_timestamp();
begin
  perform public.regenerate_instructor_access_codes();

  insert into public.cron_run_log (job_name, ok, duration_ms)
  values (
    'regenerate-instructor-access-codes',
    true,
    (extract(epoch from (clock_timestamp() - started)) * 1000)::integer
  );
exception when others then
  insert into public.cron_run_log (job_name, ok, duration_ms, error_message)
  values (
    'regenerate-instructor-access-codes',
    false,
    (extract(epoch from (clock_timestamp() - started)) * 1000)::integer,
    sqlerrm
  );
  raise;
end;
$$;

revoke all on function public.regenerate_access_codes_logged() from public;
revoke all on function public.regenerate_access_codes_logged() from anon;
revoke all on function public.regenerate_access_codes_logged() from authenticated;

select cron.unschedule('regenerate-instructor-access-codes')
where exists (select 1 from cron.job where jobname = 'regenerate-instructor-access-codes');

select cron.schedule(
  'regenerate-instructor-access-codes',
  '0 0 * * *',
  'select public.regenerate_access_codes_logged()'
);

-- ── 6. Re-schedule the 7 HTTP jobs with an explicit timeout ──────────────────
-- Identical to their previous definitions except for timeout_milliseconds.
-- Schedules are preserved exactly; do not "tidy" them.

select cron.unschedule('refresh-social-feed-cache')
where exists (select 1 from cron.job where jobname = 'refresh-social-feed-cache');
select cron.schedule('refresh-social-feed-cache', '0 3 * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/social/refresh',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.unschedule('scheduled-instructor-payouts')
where exists (select 1 from cron.job where jobname = 'scheduled-instructor-payouts');
select cron.schedule('scheduled-instructor-payouts', '0 5 * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/payouts/create',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret'),
      'X-Payout-Source', 'scheduled'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.unschedule('notify-unclaimed-opportunities')
where exists (select 1 from cron.job where jobname = 'notify-unclaimed-opportunities');
select cron.schedule('notify-unclaimed-opportunities', '0 1,2,4,5,13,14,16,17,19,20,22,23 * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/sessions/notify-unclaimed-opportunities',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.unschedule('reconcile-instructor-payouts')
where exists (select 1 from cron.job where jobname = 'reconcile-instructor-payouts');
select cron.schedule('reconcile-instructor-payouts', '15 * * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/payouts/sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.unschedule('alert-stuck-payout-batches')
where exists (select 1 from cron.job where jobname = 'alert-stuck-payout-batches');
select cron.schedule('alert-stuck-payout-batches', '0 14 * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/payouts/alert-stuck',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

select cron.unschedule('cert-expiry-reminders')
where exists (select 1 from cron.job where jobname = 'cert-expiry-reminders');
select cron.schedule('cert-expiry-reminders', '0 13 * * *', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/certifications/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- daily-ops-summary is PRODUCTION ONLY (migration 0053). This block is guarded
-- so running 0057 on staging does not accidentally create it there — admins
-- would start receiving daily emails full of seed data.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'daily-ops-summary') then
    perform cron.unschedule('daily-ops-summary');
    perform cron.schedule('daily-ops-summary', '0 11 * * *', $job$
      select net.http_post(
        url     := (select value from system_settings where key = 'app_url') || '/api/admin/daily-summary',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$);
  end if;
end
$do$;
