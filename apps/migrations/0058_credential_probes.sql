-- 0058_credential_probes.sql
--
-- Schedules the weekly third-party credential liveness probe.
--
-- WHY
--   Every external credential this app holds fails silently. A manual audit on
--   2026-08-20 found GOOGLE_PLACES_API_KEY had been refused by Google (billing
--   disabled on the GCP project) for an unknown length of time — address
--   autocomplete had been dead on three surfaces and nothing said so, because the
--   route degrades politely to "please enter the address manually" and logs to a
--   console nobody reads.
--
--   Three curl commands found it. This schedules those curl commands.
--
-- WHAT IT SCHEDULES
--   probe-credentials — Mondays 12:00 UTC, hitting /api/cron/probe-credentials.
--   That route probes Google Places, the Facebook page token, Resend (key +
--   sending-domain verification), the Turnstile secret, and the Zoho refresh
--   token, then emails super admins only when something needs attention.
--
-- HOW FAILURE ESCALATES ON ITS OWN
--   The route returns 502 when a credential is bad, so withCronHeartbeat records
--   ok=false. cron_health() measures the gap since the last *successful* run, so a
--   credential left broken past max_gap_minutes surfaces the job as overdue in the
--   daily digest. The alert email can be missed or filtered; the overdue banner
--   cannot be, without also ignoring the digest entirely.
--
-- TIMING
--   Mondays 12:00 UTC is one hour after daily-ops-summary (11:00 UTC), so a
--   credential that broke over the weekend is already reflected in Monday's
--   digest rather than waiting a further 24 hours.
--
-- IDEMPOTENT: safe to re-run. Both the schedule and the expectation upsert.

-- ── 1. Expectation row ───────────────────────────────────────────────────────
--
-- 10260 minutes = 7 days + 3 hours. Weekly cadence plus a small grace window, so
-- one late run does not fire a false overdue, but a genuinely skipped week does.
insert into public.cron_job_expectations (job_name, max_gap_minutes, note) values
  ('probe-credentials', 10260, 'Weekly Mon 12:00 UTC — 7d+3h grace; a skipped week is real')
on conflict (job_name) do update
  set max_gap_minutes = excluded.max_gap_minutes,
      note            = excluded.note;

-- ── 2. Schedule ──────────────────────────────────────────────────────────────
--
-- timeout_milliseconds := 30000 is mandatory. pg_net's signature defaults it to
-- 5000, which is what silently killed alert-stuck-payout-batches on 2026-08-19;
-- this route makes up to five outbound provider calls and will exceed 5s.
select cron.unschedule('probe-credentials')
where exists (select 1 from cron.job where jobname = 'probe-credentials');

select cron.schedule('probe-credentials', '0 12 * * 1', $$
  select net.http_post(
    url     := (select value from system_settings where key = 'app_url') || '/api/cron/probe-credentials',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- ── Verification ─────────────────────────────────────────────────────────────
-- After applying, confirm the job exists and is expected:
--
--   select jobname, schedule, active from cron.job where jobname = 'probe-credentials';
--   select * from public.cron_job_expectations where job_name = 'probe-credentials';
--
-- Then trigger it once by hand so cron_health() has a baseline — until the first
-- run lands, the job correctly reports as never-having-reported:
--
--   curl -X POST https://superherocpr.com/api/cron/probe-credentials \
--        -H "Authorization: Bearer $CRON_SECRET"
--
-- Expect 200 {"healthy":true,...} once every credential is good, or 502 with an
-- `actionable` array naming what is broken. As of 2026-08-20 a first run is
-- expected to return 502 for google_places until GCP billing is re-enabled.
