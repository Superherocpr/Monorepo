-- Migration: 0053_daily_summary_cron
-- Schedules a daily operations summary email sent to all active super_admin
-- and manager users every morning.
--
-- The email covers:
--   - Yesterday's revenue (total + per-type breakdown)
--   - Every booking (customer name, instructor, class, date/time, location)
--   - Class requests received
--   - Contact form submissions
--   - Today's class schedule with enrollment vs. capacity
--   - Outstanding invoice totals
--   - New customer registrations
--
-- SCHEDULE:
--   Fires at 12:00 UTC daily:
--     • Winter (EST, UTC-5): 7:00am ET  ← exact target
--     • Summer (EDT, UTC-4): 8:00am ET
--
-- PREREQUISITES (already in place as of migration 0050):
--   pg_cron, pg_net, and system_settings rows 'app_url' / 'cron_secret'.

select cron.unschedule('daily-ops-summary')
where exists (
  select 1 from cron.job where jobname = 'daily-ops-summary'
);

select cron.schedule(
  'daily-ops-summary',
  '0 12 * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/admin/daily-summary',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
