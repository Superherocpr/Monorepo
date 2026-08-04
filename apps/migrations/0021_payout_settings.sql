-- Migration 0021: Payout scheduling and fee settings
--
-- Adds system_settings keys that control when instructor payouts are sent
-- and what percentage SuperHeroCPR retains.
--
-- payout_trigger values:
--   immediate  — a payout batch is submitted after every booking/invoice payment
--   scheduled  — batches run on the interval defined by payout_schedule
--   manual     — batches only run when a super_admin clicks "Send Payouts Now"
--
-- payout_schedule values (only relevant when payout_trigger = 'scheduled'):
--   daily   — every day at 05:00 UTC
--   weekly  — every Monday at 05:00 UTC
--   monthly — on the 1st of each month at 05:00 UTC

INSERT INTO system_settings (key, value)
VALUES
  ('payout_trigger',  'manual'),
  ('payout_schedule', 'daily')
ON CONFLICT (key) DO NOTHING;

-- ── Scheduled payout cron job ─────────────────────────────────────────────
--
-- BEFORE RUNNING:
--   1. Enable pg_net   in the Supabase dashboard → Database → Extensions.
--   2. Enable pg_cron  in the Supabase dashboard → Database → Extensions.
--   3. Ensure system_settings has rows for 'app_url' and 'cron_secret'
--      (inserted by migration 0007 / social feed cron setup).
--
-- HOW IT WORKS:
--   The cron job fires daily at 05:00 UTC. The /api/payouts/create route
--   reads payout_trigger and payout_schedule and decides whether to actually
--   run a payout. If trigger is "immediate" or "manual", the cron call is a
--   no-op. If trigger is "scheduled", the route checks whether today matches
--   the configured schedule (daily = always, weekly = Monday, monthly = 1st).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('scheduled-instructor-payouts')
where exists (
  select 1 from cron.job where jobname = 'scheduled-instructor-payouts'
);

select cron.schedule(
  'scheduled-instructor-payouts',
  '0 5 * * *',   -- 05:00 UTC daily; the route self-gates based on schedule setting
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/payouts/create',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret'),
        'X-Payout-Source', 'scheduled'
      ),
      body    := '{}'::jsonb
    )
  $$
);
