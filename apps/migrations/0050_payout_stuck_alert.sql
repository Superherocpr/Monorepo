-- Migration: 0050_payout_stuck_alert
-- Closes a monitoring gap: reconciliation (0048) only emails super_admins at the
-- moment a batch newly transitions to `denied`. A batch already sitting in
-- `needs_review`, `denied`, or `failed` gets no further alert — someone has to
-- remember to open /admin/payouts and look. This adds a daily sweep that emails
-- a digest of every unresolved batch until it's actioned.
--
--   1. admin_alert_sent_at column — idempotency marker (mirrors the pattern
--      class_sessions.unclaimed_escalation_sent_at uses for the open-opportunity
--      escalation job in migration 0026), re-alerted after 18 hours so a batch
--      nobody actions doesn't go silent again the next day.
--   2. A partial index supporting the "which batches need re-alerting" query.
--   3. A daily cron job hitting /api/payouts/alert-stuck.

-- ── 1. Idempotency marker ───────────────────────────────────────────────────
ALTER TABLE instructor_payout_batches
  ADD COLUMN admin_alert_sent_at timestamptz;

-- ── 2. Partial index for the stuck-batch query ──────────────────────────────
CREATE INDEX idx_instructor_payout_batches_alert_pending
  ON instructor_payout_batches (admin_alert_sent_at)
  WHERE status IN ('needs_review', 'denied', 'failed');

-- ── 3. Scheduled daily stuck-payout alert ───────────────────────────────────
--
-- BEFORE RUNNING:
--   1. Enable pg_net   in the Supabase dashboard → Database → Extensions.
--   2. Enable pg_cron  in the Supabase dashboard → Database → Extensions.
--   3. Ensure system_settings has rows for 'app_url' and 'cron_secret'
--      (inserted by migration 0007 / social feed cron setup).
--
-- HOW IT WORKS:
--   Fires once daily at 14:00 UTC (~9-10am Eastern). The /api/payouts/alert-stuck
--   route finds batches in needs_review/denied/failed that haven't been alerted
--   on in the last 18 hours, emails all super_admins a digest, and marks them
--   alerted. Pure notification — it never changes batch state itself.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('alert-stuck-payout-batches')
where exists (
  select 1 from cron.job where jobname = 'alert-stuck-payout-batches'
);

select cron.schedule(
  'alert-stuck-payout-batches',
  '0 14 * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/payouts/alert-stuck',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
