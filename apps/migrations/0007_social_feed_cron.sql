-- Daily Facebook social feed cache refresh via pg_cron + pg_net.
--
-- BEFORE RUNNING:
--   1. Enable pg_net in the Supabase dashboard under Database → Extensions → pg_net.
--   2. Enable pg_cron in the Supabase dashboard under Database → Extensions → pg_cron.
--   3. Insert the required system_settings entries (see below).
--
-- REQUIRED system_settings rows (insert these once via Supabase SQL editor):
--
--   insert into system_settings (key, value) values
--     ('app_url',     'https://your-domain.com'),   -- no trailing slash
--     ('cron_secret', 'your-cron-secret-value');     -- must match CRON_SECRET env var
--
-- SCHEDULE: Runs at 03:00 UTC every day (off-peak, after access-code regeneration).

-- Enable extensions (Supabase may require dashboard activation first)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Schedule ─────────────────────────────────────────────────────────────────
-- Unschedule first so re-running this migration is idempotent.
select cron.unschedule('refresh-social-feed-cache')
where exists (
  select 1 from cron.job where jobname = 'refresh-social-feed-cache'
);

-- Schedule the job.
-- Reads app_url and cron_secret from system_settings at runtime — update those
-- rows if the domain changes rather than re-running this migration.
select cron.schedule(
  'refresh-social-feed-cache',    -- job name (unique key)
  '0 3 * * *',                    -- 03:00 UTC daily
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/social/refresh',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    );
  $$
);
