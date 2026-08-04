-- Migration: 0051_cert_reminder_milestones
-- Automates certification expiry reminders. Previously customers were only
-- reminded once, and only if a super_admin remembered to click "Send
-- Reminders to All" on /admin/certifications. This adds a fixed 90/60/30/7
-- day-before-expiry cadence, driven by a daily cron sweep instead of a
-- manual click.
--
--   1. last_reminder_sent_days replaces reminder_sent — tracks which
--      milestone (90, 60, 30, or 7 days out) was most recently emailed, so
--      the sweep can tell which stage a cert still owes instead of a single
--      on/off flag. Existing reminder_sent = true rows are treated as having
--      cleared the closest (7-day) milestone so they aren't re-emailed for a
--      stage they've likely already passed.
--   2. A partial index supporting the "which certs still owe a reminder"
--      query the sweep runs daily.
--   3. A daily cron job hitting /api/certifications/send-reminders (mirrors
--      migration 0050's alert-stuck-payout-batches job).

-- ── 1. Replace the single-shot flag with a milestone marker ────────────────
ALTER TABLE certifications
  ADD COLUMN last_reminder_sent_days smallint;

UPDATE certifications
  SET last_reminder_sent_days = 7
  WHERE reminder_sent = true;

ALTER TABLE certifications
  DROP COLUMN reminder_sent;

-- ── 2. Partial index for the daily "still due" sweep ────────────────────────
CREATE INDEX idx_certifications_reminder_pending
  ON certifications (expires_at)
  WHERE last_reminder_sent_days IS NULL OR last_reminder_sent_days > 7;

-- ── 3. Scheduled daily cert-expiry reminder sweep ───────────────────────────
--
-- BEFORE RUNNING:
--   pg_cron, pg_net, and the system_settings rows 'app_url' / 'cron_secret'
--   are already set up as of migration 0050 — nothing further to enable.
--
-- HOW IT WORKS:
--   Fires once daily at 13:00 UTC (~8-9am Eastern). The
--   /api/certifications/send-reminders route finds certs whose
--   days-until-expiry has reached the next unsent milestone (90, 60, 30, or
--   7 days out), emails the customer, and stamps last_reminder_sent_days so
--   the same milestone isn't re-sent tomorrow.

select cron.unschedule('cert-expiry-reminders')
where exists (
  select 1 from cron.job where jobname = 'cert-expiry-reminders'
);

select cron.schedule(
  'cert-expiry-reminders',
  '0 13 * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/certifications/send-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
