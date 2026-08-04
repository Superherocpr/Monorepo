-- Migration 0029: Reschedule the unclaimed-opportunity escalation cron
--
-- Was: every 30 minutes.
-- Now: 12am/9am/12pm/3pm/6pm/9pm America/New_York (business hours cadence).
--
-- pg_cron 1.6.4 (installed on both projects) has no per-job timezone support —
-- only a database-wide cron.timezone GUC, which would silently shift the other
-- three UTC-authored cron jobs in this database (payouts, daily access codes,
-- social feed). Not worth that blast radius for one job.
--
-- Instead this fires at the UTC-equivalent of all 6 Eastern hours under BOTH
-- EST (UTC-5) and EDT (UTC-4) — 12 firings/day. The route itself
-- (isScheduledEasternHour() in notify-unclaimed-opportunities/route.ts) checks
-- the real current Eastern hour and no-ops the 6 that don't match, so it's
-- correct across the DST transition with no migration needed twice a year.
--
--   Eastern targets:  0, 9, 12, 15, 18, 21
--   EST → UTC (+5):   5, 14, 17, 20, 23, 2
--   EDT → UTC (+4):   4, 13, 16, 19, 22, 1
--   Combined UTC hours: 1, 2, 4, 5, 13, 14, 16, 17, 19, 20, 22, 23

select cron.unschedule('notify-unclaimed-opportunities')
where exists (
  select 1 from cron.job where jobname = 'notify-unclaimed-opportunities'
);

select cron.schedule(
  'notify-unclaimed-opportunities',
  '0 1,2,4,5,13,14,16,17,19,20,22,23 * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/sessions/notify-unclaimed-opportunities',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
